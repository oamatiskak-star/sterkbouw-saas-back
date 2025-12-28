# backend/src/projects/routes.py
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks

from core.models import StandardResponse, UserRole
from auth.dependencies import auth_deps
from .models import *
from .service import project_service
from .permissions import project_permissions

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("/", response_model=StandardResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_data: ProjectCreate,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Create a new project
    """
    try:
        project = await project_service.create_project(project_data, current_user.sub)
        
        if not project:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to create project"
            )
        
        return StandardResponse(
            success=True,
            message="Project created successfully",
            data={"project": project.dict()}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create project: {str(e)}"
        )


@router.get("/{project_id}", response_model=StandardResponse)
async def get_project(
    project_id: str,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Get project details
    """
    try:
        project = await project_service.get_project(
            project_id, current_user.sub, current_user.role
        )
        
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found or access denied"
            )
        
        return StandardResponse(
            success=True,
            message="Project retrieved",
            data={"project": project.dict()}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get project: {str(e)}"
        )


@router.put("/{project_id}", response_model=StandardResponse)
async def update_project(
    project_id: str,
    update_data: ProjectUpdate,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Update project
    """
    try:
        project = await project_service.update_project(
            project_id, update_data, current_user.sub, current_user.role
        )
        
        if not project:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to update project"
            )
        
        return StandardResponse(
            success=True,
            message="Project updated successfully",
            data={"project": project.dict()}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update project: {str(e)}"
        )


@router.delete("/{project_id}", response_model=StandardResponse)
async def delete_project(
    project_id: str,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Delete (archive) project
    """
    try:
        success = await project_service.delete_project(
            project_id, current_user.sub, current_user.role
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to delete project"
            )
        
        return StandardResponse(
            success=True,
            message="Project archived successfully",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete project: {str(e)}"
        )


@router.get("/", response_model=StandardResponse)
async def list_projects(
    status: Optional[List[ProjectStatus]] = Query(None),
    project_type: Optional[List[ProjectType]] = Query(None),
    priority: Optional[List[ProjectPriority]] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    sort_by: str = Query("updated_at"),
    sort_order: str = Query("desc", regex="^(asc|desc)$"),
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    List projects with filtering and pagination
    """
    try:
        filters = ProjectFilter(
            status=status,
            project_type=project_type,
            priority=priority,
            search=search
        )
        
        pagination = PaginationParams(
            page=page,
            limit=limit,
            sort_by=sort_by,
            sort_order=sort_order
        )
        
        projects, total = await project_service.search_projects(
            filters, current_user.sub, current_user.role, pagination
        )
        
        return StandardResponse(
            success=True,
            message=f"Found {total} projects",
            data={
                "projects": [p.dict() for p in projects],
                "pagination": {
                    "page": page,
                    "limit": limit,
                    "total": total,
                    "pages": (total + limit - 1) // limit
                }
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list projects: {str(e)}"
        )


# Team management routes
@router.post("/{project_id}/team", response_model=StandardResponse)
async def add_team_member(
    project_id: str,
    user_id: str,
    role: TeamRole = TeamRole.VIEWER,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Add user to project team
    """
    try:
        success = await project_service.add_team_member(
            project_id, user_id, current_user.sub, role
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to add team member"
            )
        
        return StandardResponse(
            success=True,
            message="Team member added successfully",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to add team member: {str(e)}"
        )


@router.delete("/{project_id}/team/{member_id}", response_model=StandardResponse)
async def remove_team_member(
    project_id: str,
    member_id: str,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Remove user from project team
    """
    try:
        success = await project_service.remove_team_member(
            project_id, member_id, current_user.sub, current_user.role
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to remove team member"
            )
        
        return StandardResponse(
            success=True,
            message="Team member removed successfully",
            data=None
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to remove team member: {str(e)}"
        )


@router.get("/{project_id}/team", response_model=StandardResponse)
async def get_project_team(
    project_id: str,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Get project team members
    """
    try:
        # Check permissions
        team_member = await project_service.db.get_team_member(project_id, current_user.sub)
        await project_permissions.require_permission(
            current_user.sub, current_user.role, project_id, team_member, "view"
        )
        
        team_members = await project_service.db.get_project_team_members(project_id)
        
        return StandardResponse(
            success=True,
            message=f"Found {len(team_members)} team members",
            data={"team_members": team_members}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get team members: {str(e)}"
        )


# Document management routes
@router.post("/{project_id}/documents", response_model=StandardResponse)
async def upload_document(
    project_id: str,
    document_data: DocumentCreate,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Upload document to project
    """
    try:
        document = await project_service.add_document(
            document_data, current_user.sub, current_user.role
        )
        
        if not document:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to upload document"
            )
        
        return StandardResponse(
            success=True,
            message="Document uploaded successfully",
            data={"document": document.dict()}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload document: {str(e)}"
        )


@router.get("/{project_id}/documents", response_model=StandardResponse)
async def get_project_documents(
    project_id: str,
    document_type: Optional[DocumentType] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Get project documents
    """
    try:
        # Check permissions
        team_member = await project_service.db.get_team_member(project_id, current_user.sub)
        await project_permissions.require_permission(
            current_user.sub, current_user.role, project_id, team_member, "view"
        )
        
        documents = await project_service.db.get_project_documents(
            project_id, document_type=document_type, page=page, limit=limit
        )
        total = await project_service.db.count_project_documents(project_id, document_type)
        
        return StandardResponse(
            success=True,
            message=f"Found {total} documents",
            data={
                "documents": documents,
                "pagination": {
                    "page": page,
                    "limit": limit,
                    "total": total,
                    "pages": (total + limit - 1) // limit
                }
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get documents: {str(e)}"
        )


# Task management routes
@router.post("/{project_id}/tasks", response_model=StandardResponse)
async def create_task(
    project_id: str,
    task_data: TaskCreate,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Create task in project
    """
    try:
        task = await project_service.create_task(
            task_data, current_user.sub, current_user.role
        )
        
        if not task:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to create task"
            )
        
        return StandardResponse(
            success=True,
            message="Task created successfully",
            data={"task": task.dict()}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create task: {str(e)}"
        )


@router.get("/{project_id}/tasks", response_model=StandardResponse)
async def get_project_tasks(
    project_id: str,
    status: Optional[TaskStatus] = None,
    assigned_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Get project tasks
    """
    try:
        # Check permissions
        team_member = await project_service.db.get_team_member(project_id, current_user.sub)
        await project_permissions.require_permission(
            current_user.sub, current_user.role, project_id, team_member, "view"
        )
        
        tasks = await project_service.db.get_project_tasks(
            project_id, status=status, assigned_to=assigned_to, page=page, limit=limit
        )
        total = await project_service.db.count_project_tasks(project_id, status, assigned_to)
        
        return StandardResponse(
            success=True,
            message=f"Found {total} tasks",
            data={
                "tasks": tasks,
                "pagination": {
                    "page": page,
                    "limit": limit,
                    "total": total,
                    "pages": (total + limit - 1) // limit
                }
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get tasks: {str(e)}"
        )


# Statistics and dashboard
@router.get("/company/{company_id}/stats", response_model=StandardResponse)
async def get_company_project_stats(
    company_id: str,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Get project statistics for company
    """
    try:
        stats = await project_service.get_project_stats(
            company_id, current_user.sub, current_user.role
        )
        
        if not stats:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No statistics found or access denied"
            )
        
        return StandardResponse(
            success=True,
            message="Statistics retrieved",
            data={"stats": stats.dict()}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get statistics: {str(e)}"
        )


@router.get("/user/dashboard", response_model=StandardResponse)
async def get_user_dashboard(
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Get user dashboard with recent projects and tasks
    """
    try:
        # Get recent projects
        recent_projects = await project_service.db.get_user_recent_projects(
            current_user.sub, limit=5
        )
        
        # Get assigned tasks
        assigned_tasks = await project_service.db.get_user_assigned_tasks(
            current_user.sub, limit=10
        )
        
        # Get overdue tasks
        overdue_tasks = await project_service.db.get_user_overdue_tasks(
            current_user.sub
        )
        
        return StandardResponse(
            success=True,
            message="Dashboard data retrieved",
            data={
                "recent_projects": recent_projects,
                "assigned_tasks": assigned_tasks,
                "overdue_tasks": overdue_tasks,
                "stats": {
                    "active_projects": len([p for p in recent_projects if p.get("status") == "active"]),
                    "total_tasks": len(assigned_tasks),
                    "overdue_tasks": len(overdue_tasks)
                }
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get dashboard: {str(e)}"
        )


# Template routes
@router.post("/templates", response_model=StandardResponse)
async def create_project_template(
    template_data: ProjectTemplateCreate,
    current_user: dict = Depends(auth_deps.require_project_manager)
):
    """
    Create project template
    """
    try:
        template_dict = {
            **template_data.dict(),
            "id": str(uuid.uuid4()),
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        template = await project_service.db.create_project_template(template_dict)
        
        if not template:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to create template"
            )
        
        return StandardResponse(
            success=True,
            message="Template created successfully",
            data={"template": template}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create template: {str(e)}"
        )


@router.post("/from-template/{template_id}", response_model=StandardResponse)
async def create_from_template(
    template_id: str,
    project_data: ProjectCreate,
    current_user: dict = Depends(auth_deps.get_current_user)
):
    """
    Create project from template
    """
    try:
        project = await project_service.create_project_from_template(
            template_id, project_data, current_user.sub, current_user.role
        )
        
        if not project:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to create project from template"
            )
        
        return StandardResponse(
            success=True,
            message="Project created from template successfully",
            data={"project": project.dict()}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create project from template: {str(e)}"
        )
