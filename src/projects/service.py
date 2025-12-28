# backend/src/projects/service.py
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timedelta
import uuid

from core.database import database
from core.models import UserRole
from auth.security import security_service
from .models import *
from .permissions import project_permissions


class ProjectService:
    def __init__(self):
        self.db = database
    
    # Project operations
    async def create_project(self, project_data: ProjectCreate, user_id: str) -> Optional[ProjectInDB]:
        """Create a new project"""
        try:
            # Check if user has permission to create projects in company
            # (In production, check company subscription limits)
            
            project_id = str(uuid.uuid4())
            project_dict = {
                **project_data.dict(exclude={"company_id"}),
                "id": project_id,
                "company_id": project_data.company_id,
                "created_by": user_id,
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
                "document_count": 0,
                "task_count": 0,
                "team_member_count": 1,
                "calculation_count": 0
            }
            
            # Create project in database
            project = await self.db.create_project(project_dict)
            if not project:
                return None
            
            # Add creator as project owner
            await self.add_team_member(
                project_id=project_id,
                user_id=user_id,
                inviter_id=user_id,
                role=TeamRole.OWNER
            )
            
            return ProjectInDB(**project)
            
        except Exception as e:
            print(f"Error creating project: {e}")
            return None
    
    async def get_project(self, project_id: str, user_id: str, user_role: UserRole) -> Optional[ProjectWithDetails]:
        """Get project with details"""
        try:
            # Get project
            project = await self.db.get_project_by_id(project_id)
            if not project:
                return None
            
            # Check permissions
            team_member = await self.db.get_team_member(project_id, user_id)
            has_access = await project_permissions.check_permission(
                user_id, user_role, project_id, team_member, "view"
            )
            
            if not has_access:
                return None
            
            # Get related data
            team_members = await self.db.get_project_team_members(project_id)
            documents = await self.db.get_project_documents(project_id, limit=5)
            tasks = await self.db.get_project_tasks(project_id, limit=5)
            calculations = await self.db.get_project_calculations(project_id)
            
            # Convert to models
            project_model = ProjectInDB(**project)
            
            return ProjectWithDetails(
                **project_model.dict(),
                team_members=[
                    TeamMemberPublic(
                        **member,
                        user_email=member.get("email"),
                        user_name=f"{member.get('first_name', '')} {member.get('last_name', '')}".strip()
                    )
                    for member in team_members
                ],
                recent_documents=[DocumentPublic(**doc) for doc in documents],
                recent_tasks=[TaskPublic(**task) for task in tasks],
                calculations=[CalculationInDB(**calc) for calc in calculations]
            )
            
        except Exception as e:
            print(f"Error getting project: {e}")
            return None
    
    async def update_project(self, project_id: str, update_data: ProjectUpdate, 
                           user_id: str, user_role: UserRole) -> Optional[ProjectInDB]:
        """Update project"""
        try:
            # Get project and check permissions
            project = await self.db.get_project_by_id(project_id)
            if not project:
                return None
            
            team_member = await self.db.get_team_member(project_id, user_id)
            await project_permissions.require_permission(
                user_id, user_role, project_id, team_member, "edit",
                ProjectStatus(project.get("status"))
            )
            
            # Prepare update data
            update_dict = update_data.dict(exclude_unset=True)
            update_dict["updated_at"] = datetime.now().isoformat()
            
            # Update project
            updated = await self.db.update_project(project_id, update_dict)
            if not updated:
                return None
            
            return ProjectInDB(**updated)
            
        except Exception as e:
            print(f"Error updating project: {e}")
            return None
    
    async def delete_project(self, project_id: str, user_id: str, user_role: UserRole) -> bool:
        """Delete project (soft delete by archiving)"""
        try:
            # Get project and check permissions
            project = await self.db.get_project_by_id(project_id)
            if not project:
                return False
            
            team_member = await self.db.get_team_member(project_id, user_id)
            await project_permissions.require_permission(
                user_id, user_role, project_id, team_member, "delete",
                ProjectStatus(project.get("status"))
            )
            
            # Archive project instead of deleting
            update_data = {
                "status": ProjectStatus.ARCHIVED.value,
                "archived_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }
            
            updated = await self.db.update_project(project_id, update_data)
            return updated is not None
            
        except Exception as e:
            print(f"Error deleting project: {e}")
            return False
    
    # Team operations
    async def add_team_member(self, project_id: str, user_id: str, 
                            inviter_id: str, role: TeamRole = TeamRole.VIEWER) -> bool:
        """Add user to project team"""
        try:
            # Check if inviter has permission
            project = await self.db.get_project_by_id(project_id)
            if not project:
                return False
            
            # Check if user is already in team
            existing = await self.db.get_team_member(project_id, user_id)
            if existing:
                return True  # Already a member
            
            # Create team member
            team_member_data = {
                "id": str(uuid.uuid4()),
                "project_id": project_id,
                "user_id": user_id,
                "invited_by": inviter_id,
                "role": role.value,
                "is_active": True,
                "invited_at": datetime.now().isoformat(),
                "joined_at": datetime.now().isoformat(),
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }
            
            member = await self.db.create_team_member(team_member_data)
            
            # Update project team count
            if member:
                await self.db.increment_project_team_count(project_id)
            
            return member is not None
            
        except Exception as e:
            print(f"Error adding team member: {e}")
            return False
    
    async def remove_team_member(self, project_id: str, member_id: str, 
                               remover_id: str, user_role: UserRole) -> bool:
        """Remove user from project team"""
        try:
            # Get team member
            member = await self.db.get_team_member_by_id(member_id)
            if not member or member["project_id"] != project_id:
                return False
            
            # Check if remover has permission
            remover_member = await self.db.get_team_member(project_id, remover_id)
            
            # Can't remove yourself if you're the only owner
            if member["user_id"] == remover_id:
                # Check if there are other owners
                owners = await self.db.get_project_owners(project_id)
                if len(owners) <= 1 and member["role"] == TeamRole.OWNER.value:
                    return False  # Can't remove last owner
            
            # Check permissions
            has_permission = await project_permissions.check_permission(
                remover_id, user_role, project_id, remover_member, "manage_team"
            )
            
            if not has_permission:
                # Can't remove members with higher or equal role
                remover_role = TeamRole(remover_member.get("role", TeamRole.VIEWER))
                member_role = TeamRole(member.get("role", TeamRole.VIEWER))
                
                if not await project_permissions.can_invite_members(remover_role, member_role):
                    return False
            
            # Remove team member
            success = await self.db.delete_team_member(member_id)
            
            # Update project team count
            if success:
                await self.db.decrement_project_team_count(project_id)
            
            return success
            
        except Exception as e:
            print(f"Error removing team member: {e}")
            return False
    
    # Document operations
    async def add_document(self, document_data: DocumentCreate, 
                          user_id: str, user_role: UserRole) -> Optional[DocumentInDB]:
        """Add document to project"""
        try:
            # Check permissions
            team_member = await self.db.get_team_member(document_data.project_id, user_id)
            has_permission = await project_permissions.check_permission(
                user_id, user_role, document_data.project_id, team_member, "manage_documents"
            )
            
            if not has_permission:
                return None
            
            # Create document
            document_dict = {
                **document_data.dict(exclude={"project_id", "uploaded_by"}),
                "id": str(uuid.uuid4()),
                "project_id": document_data.project_id,
                "uploaded_by": user_id,
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }
            
            document = await self.db.create_document(document_dict)
            if not document:
                return None
            
            # Update project document count
            await self.db.increment_project_document_count(document_data.project_id)
            
            return DocumentInDB(**document)
            
        except Exception as e:
            print(f"Error adding document: {e}")
            return None
    
    # Task operations
    async def create_task(self, task_data: TaskCreate, 
                         user_id: str, user_role: UserRole) -> Optional[TaskInDB]:
        """Create task in project"""
        try:
            # Check permissions
            team_member = await self.db.get_team_member(task_data.project_id, user_id)
            has_permission = await project_permissions.check_permission(
                user_id, user_role, task_data.project_id, team_member, "manage_tasks"
            )
            
            if not has_permission:
                return None
            
            # Create task
            task_dict = {
                **task_data.dict(exclude={"project_id", "created_by"}),
                "id": str(uuid.uuid4()),
                "project_id": task_data.project_id,
                "created_by": user_id,
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }
            
            task = await self.db.create_task(task_dict)
            if not task:
                return None
            
            # Update project task count
            await self.db.increment_project_task_count(task_data.project_id)
            
            return TaskInDB(**task)
            
        except Exception as e:
            print(f"Error creating task: {e}")
            return None
    
    # Search and filter
    async def search_projects(self, filters: ProjectFilter, 
                            user_id: str, user_role: UserRole,
                            pagination: PaginationParams) -> Tuple[List[ProjectPublic], int]:
        """Search projects with filters"""
        try:
            # Apply access control
            if user_role != UserRole.ADMIN:
                # For non-admins, only show projects they have access to
                # This would require joining with team_members table
                pass
            
            # Convert filters to database query
            query_filters = {}
            if filters.status:
                query_filters["status"] = filters.status
            if filters.project_type:
                query_filters["project_type"] = filters.project_type
            if filters.search:
                query_filters["search"] = filters.search
            
            # Get projects from database
            projects = await self.db.search_projects(
                filters=query_filters,
                page=pagination.page,
                limit=pagination.limit,
                sort_by=pagination.sort_by,
                sort_order=pagination.sort_order
            )
            
            total = await self.db.count_projects(query_filters)
            
            return [ProjectPublic(**p) for p in projects], total
            
        except Exception as e:
            print(f"Error searching projects: {e}")
            return [], 0
    
    async def get_project_stats(self, company_id: str, user_id: str, user_role: UserRole) -> Optional[ProjectStats]:
        """Get project statistics for company"""
        try:
            # Check if user has access to company stats
            if user_role not in [UserRole.ADMIN, UserRole.COMPANY_ADMIN]:
                # Check if user belongs to company
                user = await self.db.get_user_by_id(user_id)
                if user.get("company_id") != company_id:
                    return None
            
            stats = await self.db.get_company_project_stats(company_id)
            
            return ProjectStats(**stats) if stats else None
            
        except Exception as e:
            print(f"Error getting project stats: {e}")
            return None
    
    # Template operations
    async def create_project_from_template(self, template_id: str, 
                                         project_data: ProjectCreate,
                                         user_id: str, user_role: UserRole) -> Optional[ProjectInDB]:
        """Create project from template"""
        try:
            # Get template
            template = await self.db.get_project_template(template_id)
            if not template:
                return None
            
            # Check if user has access to template
            if not template.get("is_public") and template.get("company_id") != project_data.company_id:
                return None
            
            # Create project
            project = await self.create_project(project_data, user_id)
            if not project:
                return None
            
            # Apply template content (tasks, documents structure, etc.)
            # This would require more complex logic based on template content
            
            # Increment template usage
            await self.db.increment_template_usage(template_id)
            
            return project
            
        except Exception as e:
            print(f"Error creating project from template: {e}")
            return None


# Create service instance
project_service = ProjectService()
