# backend/src/projects/permissions.py
from typing import Optional, List
from fastapi import HTTPException, status

from core.models import UserRole
from .models import TeamRole, ProjectStatus


class ProjectPermissions:
    """Project-level permission checking"""
    
    # Permission matrix: role -> allowed actions
    PROJECT_PERMISSIONS = {
        TeamRole.OWNER: {
            "view": True,
            "edit": True,
            "delete": True,
            "manage_team": True,
            "manage_documents": True,
            "manage_tasks": True,
            "manage_calculations": True,
            "change_settings": True,
            "archive": True,
        },
        TeamRole.MANAGER: {
            "view": True,
            "edit": True,
            "delete": False,
            "manage_team": True,
            "manage_documents": True,
            "manage_tasks": True,
            "manage_calculations": True,
            "change_settings": True,
            "archive": False,
        },
        TeamRole.MEMBER: {
            "view": True,
            "edit": True,
            "delete": False,
            "manage_team": False,
            "manage_documents": True,
            "manage_tasks": True,
            "manage_calculations": True,
            "change_settings": False,
            "archive": False,
        },
        TeamRole.VIEWER: {
            "view": True,
            "edit": False,
            "delete": False,
            "manage_team": False,
            "manage_documents": False,
            "manage_tasks": False,
            "manage_calculations": False,
            "change_settings": False,
            "archive": False,
        },
    }
    
    @staticmethod
    async def check_permission(
        user_id: str,
        user_role: UserRole,
        project_id: str,
        team_member: Optional[dict],
        action: str,
        project_status: Optional[ProjectStatus] = None
    ) -> bool:
        """
        Check if user has permission for action on project
        
        Args:
            user_id: Current user ID
            user_role: User's global role
            project_id: Project ID
            team_member: Team member record if user is in project team
            action: Action to check (view, edit, delete, etc.)
            project_status: Current project status
            
        Returns:
            bool: True if allowed
        """
        # Global admin has all permissions
        if user_role == UserRole.ADMIN:
            return True
        
        # Company admin has all permissions for their company's projects
        if user_role == UserRole.COMPANY_ADMIN:
            # In production, check if project belongs to user's company
            return True
        
        # Check if user is team member
        if not team_member:
            return False
        
        # Get team role
        team_role = TeamRole(team_member.get("role", TeamRole.VIEWER))
        
        # Check if team member is active
        if not team_member.get("is_active", False):
            return False
        
        # Get permissions for team role
        role_permissions = ProjectPermissions.PROJECT_PERMISSIONS.get(team_role, {})
        
        # Check specific action
        if action not in role_permissions:
            return False
        
        # Additional checks based on project status
        if project_status:
            # Can't edit archived projects
            if project_status == ProjectStatus.ARCHIVED and action in ["edit", "delete"]:
                return False
            
            # Only owners/managers can change completed projects
            if project_status == ProjectStatus.COMPLETED and action in ["edit"]:
                return team_role in [TeamRole.OWNER, TeamRole.MANAGER]
        
        return role_permissions.get(action, False)
    
    @staticmethod
    async def require_permission(
        user_id: str,
        user_role: UserRole,
        project_id: str,
        team_member: Optional[dict],
        action: str,
        project_status: Optional[ProjectStatus] = None
    ):
        """
        Require permission or raise HTTPException
        """
        has_permission = await ProjectPermissions.check_permission(
            user_id, user_role, project_id, team_member, action, project_status
        )
        
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions for action: {action}"
            )
    
    @staticmethod
    def get_required_role_for_action(action: str) -> TeamRole:
        """
        Get minimum team role required for an action
        """
        action_to_role = {
            "view": TeamRole.VIEWER,
            "edit": TeamRole.MEMBER,
            "delete": TeamRole.OWNER,
            "manage_team": TeamRole.MANAGER,
            "manage_documents": TeamRole.MEMBER,
            "manage_tasks": TeamRole.MEMBER,
            "manage_calculations": TeamRole.MEMBER,
            "change_settings": TeamRole.MANAGER,
            "archive": TeamRole.OWNER,
        }
        
        return action_to_role.get(action, TeamRole.OWNER)
    
    @staticmethod
    async def can_invite_members(
        inviter_role: TeamRole,
        invitee_role: TeamRole
    ) -> bool:
        """
        Check if user can invite members with specific role
        """
        # Can only invite members with equal or lower role
        role_hierarchy = {
            TeamRole.OWNER: 4,
            TeamRole.MANAGER: 3,
            TeamRole.MEMBER: 2,
            TeamRole.VIEWER: 1
        }
        
        inviter_level = role_hierarchy.get(inviter_role, 0)
        invitee_level = role_hierarchy.get(invitee_role, 0)
        
        return inviter_level >= invitee_level


# Export permissions instance
project_permissions = ProjectPermissions()
