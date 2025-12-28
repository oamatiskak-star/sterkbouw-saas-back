# backend/src/projects/models.py
from datetime import datetime
from typing import Optional, List, Dict, Any
from enum import Enum
from pydantic import BaseModel, Field, validator
import uuid


# Enums
class ProjectStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    ON_HOLD = "on_hold"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class ProjectType(str, Enum):
    NEW_CONSTRUCTION = "new_construction"
    RENOVATION = "renovation"
    RESTORATION = "restoration"
    MAINTENANCE = "maintenance"
    DEMOLITION = "demolition"
    OTHER = "other"


class ProjectPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class DocumentType(str, Enum):
    DRAWING = "drawing"
    REPORT = "report"
    CONTRACT = "contract"
    PERMIT = "permit"
    INVOICE = "invoice"
    SPECIFICATION = "specification"
    OTHER = "other"


class DocumentStatus(str, Enum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    ANALYZED = "analyzed"
    ERROR = "error"


class TaskStatus(str, Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    REVIEW = "review"
    COMPLETED = "completed"
    BLOCKED = "blocked"


class TeamRole(str, Enum):
    OWNER = "owner"
    MANAGER = "manager"
    MEMBER = "member"
    VIEWER = "viewer"


# Base model
class BaseProjectModel(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    
    class Config:
        from_attributes = True


# Project models
class ProjectBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    project_type: ProjectType = ProjectType.NEW_CONSTRUCTION
    status: ProjectStatus = ProjectStatus.DRAFT
    priority: ProjectPriority = ProjectPriority.MEDIUM
    
    # Location
    address: Optional[str] = None
    city: Optional[str] = None
    postal_code: Optional[str] = None
    country: str = "Netherlands"
    
    # Dates
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    
    # Financial
    budget: Optional[float] = None
    currency: str = "EUR"
    
    # Measurements
    surface_area: Optional[float] = None  # m²
    volume: Optional[float] = None  # m³
    
    # Metadata
    tags: List[str] = Field(default_factory=list)
    custom_fields: Dict[str, Any] = Field(default_factory=dict)


class ProjectCreate(ProjectBase):
    company_id: str


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    project_type: Optional[ProjectType] = None
    status: Optional[ProjectStatus] = None
    priority: Optional[ProjectPriority] = None
    address: Optional[str] = None
    city: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    budget: Optional[float] = None
    surface_area: Optional[float] = None
    volume: Optional[float] = None
    tags: Optional[List[str]] = None
    custom_fields: Optional[Dict[str, Any]] = None
    
    @validator('end_date')
    def validate_dates(cls, v, values):
        if 'start_date' in values and v and values['start_date']:
            if v < values['start_date']:
                raise ValueError('end_date must be after start_date')
        return v


class ProjectInDB(BaseProjectModel, ProjectBase):
    company_id: str
    created_by: str  # user_id
    is_template: bool = False
    template_id: Optional[str] = None
    
    # Statistics
    document_count: int = 0
    task_count: int = 0
    team_member_count: int = 0
    calculation_count: int = 0
    
    # Timestamps
    archived_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class ProjectPublic(ProjectBase):
    id: str
    company_id: str
    created_by: str
    document_count: int
    task_count: int
    team_member_count: int
    created_at: datetime
    updated_at: datetime


# Document models
class DocumentBase(BaseModel):
    name: str
    description: Optional[str] = None
    document_type: DocumentType
    status: DocumentStatus = DocumentStatus.UPLOADED
    file_path: str
    file_size: int
    mime_type: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DocumentCreate(DocumentBase):
    project_id: str
    uploaded_by: str  # user_id


class DocumentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[DocumentStatus] = None
    metadata: Optional[Dict[str, Any]] = None


class DocumentInDB(BaseProjectModel, DocumentBase):
    project_id: str
    uploaded_by: str
    analysis_result: Optional[Dict[str, Any]] = None
    analysis_date: Optional[datetime] = None
    version: int = 1
    parent_id: Optional[str] = None  # For versioning


class DocumentPublic(DocumentBase):
    id: str
    project_id: str
    uploaded_by: str
    status: DocumentStatus
    analysis_result: Optional[Dict[str, Any]] = None
    version: int
    created_at: datetime
    updated_at: datetime


# Task models
class TaskBase(BaseModel):
    title: str
    description: Optional[str] = None
    status: TaskStatus = TaskStatus.TODO
    priority: ProjectPriority = ProjectPriority.MEDIUM
    
    # Assignments
    assigned_to: Optional[str] = None  # user_id
    assigned_by: Optional[str] = None  # user_id
    
    # Dates
    due_date: Optional[datetime] = None
    start_date: Optional[datetime] = None
    completed_date: Optional[datetime] = None
    
    # Estimates
    estimated_hours: Optional[float] = None
    actual_hours: Optional[float] = None
    
    # Relationships
    depends_on: List[str] = Field(default_factory=list)  # task_ids
    related_documents: List[str] = Field(default_factory=list)  # document_ids
    
    # Metadata
    tags: List[str] = Field(default_factory=list)
    custom_fields: Dict[str, Any] = Field(default_factory=dict)


class TaskCreate(TaskBase):
    project_id: str
    created_by: str  # user_id


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    priority: Optional[ProjectPriority] = None
    assigned_to: Optional[str] = None
    due_date: Optional[datetime] = None
    start_date: Optional[datetime] = None
    completed_date: Optional[datetime] = None
    estimated_hours: Optional[float] = None
    actual_hours: Optional[float] = None
    depends_on: Optional[List[str]] = None
    related_documents: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    custom_fields: Optional[Dict[str, Any]] = None


class TaskInDB(BaseProjectModel, TaskBase):
    project_id: str
    created_by: str
    completed_by: Optional[str] = None
    position: int = 0  # For ordering


class TaskPublic(TaskBase):
    id: str
    project_id: str
    created_by: str
    status: TaskStatus
    position: int
    created_at: datetime
    updated_at: datetime


# Team models
class TeamMemberBase(BaseModel):
    role: TeamRole = TeamRole.VIEWER
    notifications_enabled: bool = True
    custom_permissions: Dict[str, bool] = Field(default_factory=dict)


class TeamMemberCreate(TeamMemberBase):
    project_id: str
    user_id: str
    invited_by: str  # user_id


class TeamMemberUpdate(BaseModel):
    role: Optional[TeamRole] = None
    notifications_enabled: Optional[bool] = None
    custom_permissions: Optional[Dict[str, bool]] = None


class TeamMemberInDB(BaseProjectModel, TeamMemberBase):
    project_id: str
    user_id: str
    invited_by: str
    invited_at: datetime = Field(default_factory=datetime.now)
    joined_at: Optional[datetime] = None
    is_active: bool = True


class TeamMemberPublic(TeamMemberBase):
    id: str
    project_id: str
    user_id: str
    user_email: Optional[str] = None
    user_name: Optional[str] = None
    role: TeamRole
    is_active: bool
    invited_at: datetime
    joined_at: Optional[datetime]


# Template models
class ProjectTemplateBase(BaseModel):
    name: str
    description: Optional[str] = None
    project_type: ProjectType
    content: Dict[str, Any]  # Serialized project structure
    is_public: bool = False
    tags: List[str] = Field(default_factory=list)


class ProjectTemplateCreate(ProjectTemplateBase):
    company_id: str
    created_by: str  # user_id


class ProjectTemplateInDB(BaseProjectModel, ProjectTemplateBase):
    company_id: str
    created_by: str
    used_count: int = 0


# Calculation models (link naar Executor)
class CalculationBase(BaseModel):
    calculation_data: Dict[str, Any]
    version: str = "1.0"
    total_cost: float
    currency: str = "EUR"
    status: str = "draft"
    notes: Optional[str] = None


class CalculationCreate(CalculationBase):
    project_id: str
    created_by: str  # user_id


class CalculationInDB(BaseProjectModel, CalculationBase):
    project_id: str
    created_by: str
    document_ids: List[str] = Field(default_factory=list)
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None


# Response models
class ProjectWithDetails(ProjectPublic):
    team_members: List[TeamMemberPublic] = Field(default_factory=list)
    recent_documents: List[DocumentPublic] = Field(default_factory=list)
    recent_tasks: List[TaskPublic] = Field(default_factory=list)
    calculations: List[CalculationInDB] = Field(default_factory=list)


class ProjectStats(BaseModel):
    total_projects: int
    active_projects: int
    completed_projects: int
    total_documents: int
    total_tasks: int
    overdue_tasks: int
    total_budget: float
    spent_budget: float


# Search and filter models
class ProjectFilter(BaseModel):
    status: Optional[List[ProjectStatus]] = None
    project_type: Optional[List[ProjectType]] = None
    priority: Optional[List[ProjectPriority]] = None
    company_id: Optional[str] = None
    created_by: Optional[str] = None
    start_date_from: Optional[datetime] = None
    start_date_to: Optional[datetime] = None
    end_date_from: Optional[datetime] = None
    end_date_to: Optional[datetime] = None
    tags: Optional[List[str]] = None
    search: Optional[str] = None


class PaginationParams(BaseModel):
    page: int = 1
    limit: int = 20
    sort_by: str = "updated_at"
    sort_order: str = "desc"  # asc or desc
