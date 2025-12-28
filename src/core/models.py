# backend/src/core/models.py
from datetime import datetime
from typing import Optional, List, Dict, Any
from enum import Enum
from pydantic import BaseModel, EmailStr, Field, validator
import uuid


# Enums
class UserRole(str, Enum):
    ADMIN = "admin"
    COMPANY_ADMIN = "company_admin"
    PROJECT_MANAGER = "project_manager"
    ESTIMATOR = "estimator"
    VIEWER = "viewer"


class UserStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    PENDING = "pending"


class CompanyType(str, Enum):
    CONTRACTOR = "contractor"
    ARCHITECT = "architect"
    DEVELOPER = "developer"
    SUPPLIER = "supplier"
    GOVERNMENT = "government"
    OTHER = "other"


class PlanType(str, Enum):
    FREE = "free"
    BASIC = "basic"
    PROFESSIONAL = "professional"
    ENTERPRISE = "enterprise"


# Base models
class BaseDBModel(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    
    class Config:
        from_attributes = True


# User related models
class UserBase(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    phone: Optional[str] = None
    avatar_url: Optional[str] = None


class UserCreate(UserBase):
    password: str = Field(min_length=8)
    company_name: Optional[str] = None
    company_type: Optional[CompanyType] = None
    
    @validator("password")
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        # Add more password strength checks as needed
        return v


class UserUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


class UserInDB(BaseDBModel, UserBase):
    role: UserRole = UserRole.VIEWER
    status: UserStatus = UserStatus.ACTIVE
    email_verified: bool = False
    company_id: Optional[str] = None
    hashed_password: str
    
    class Config:
        from_attributes = True


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    first_name: str
    last_name: str
    role: UserRole
    status: UserStatus
    company_id: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: datetime


# Company models
class CompanyBase(BaseModel):
    name: str
    company_type: CompanyType
    kvk_number: Optional[str] = None
    vat_number: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    postal_code: Optional[str] = None
    country: str = "Netherlands"
    website: Optional[str] = None
    phone: Optional[str] = None


class CompanyCreate(CompanyBase):
    pass


class CompanyInDB(BaseDBModel, CompanyBase):
    owner_id: str
    plan_type: PlanType = PlanType.FREE
    subscription_status: str = "inactive"
    subscription_id: Optional[str] = None
    users_count: int = 0
    projects_count: int = 0


class CompanyPublic(CompanyBase):
    id: str
    owner_id: str
    plan_type: PlanType
    users_count: int
    projects_count: int
    created_at: datetime


# Auth models
class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class TokenPayload(BaseModel):
    sub: str  # user_id
    email: str
    role: UserRole
    company_id: Optional[str] = None
    exp: int


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    remember_me: bool = False


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


class EmailVerificationRequest(BaseModel):
    token: str


# Session models
class SessionCreate(BaseModel):
    user_id: str
    token: str
    user_agent: Optional[str] = None
    ip_address: Optional[str] = None
    expires_at: datetime


class SessionInDB(BaseDBModel):
    user_id: str
    token: str
    user_agent: Optional[str] = None
    ip_address: Optional[str] = None
    expires_at: datetime
    last_used_at: datetime = Field(default_factory=datetime.now)


# Response models
class StandardResponse(BaseModel):
    success: bool
    message: str
    data: Optional[Dict[str, Any]] = None


class PaginatedResponse(BaseModel):
    items: List[Any]
    total: int
    page: int
    size: int
    pages: int
