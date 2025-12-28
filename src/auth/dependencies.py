# backend/src/auth/dependencies.py
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from core.config import settings
from core.models import TokenPayload, UserRole
from .security import security_service, get_current_user, require_role

# OAuth2 scheme for token extraction
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/login",
    auto_error=False
)


class AuthDependencies:
    """Authentication and authorization dependencies"""
    
    @staticmethod
    async def get_current_user_optional(
        token: Optional[str] = Depends(oauth2_scheme)
    ) -> Optional[TokenPayload]:
        """
        Optional dependency to get current user.
        Returns None if no valid token provided.
        """
        if not token:
            return None
        return get_current_user(token)
    
    @staticmethod
    async def get_current_user(
        token: Optional[str] = Depends(oauth2_scheme)
    ) -> TokenPayload:
        """
        Required dependency to get current user.
        Raises 401 if no valid token provided.
        """
        if not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        user = get_current_user(token)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        return user
    
    @staticmethod
    async def get_current_active_user(
        current_user: TokenPayload = Depends(get_current_user)
    ) -> TokenPayload:
        """Require active user (not suspended or inactive)"""
        # In production, check user status in database
        # For now, just return the user
        return current_user
    
    @staticmethod
    async def require_admin(
        current_user: TokenPayload = Depends(get_current_active_user)
    ) -> TokenPayload:
        """Require admin role"""
        return require_role(UserRole.ADMIN)(current_user)
    
    @staticmethod
    async def require_company_admin(
        current_user: TokenPayload = Depends(get_current_active_user)
    ) -> TokenPayload:
        """Require company admin or higher"""
        return require_role(UserRole.COMPANY_ADMIN)(current_user)
    
    @staticmethod
    async def require_project_manager(
        current_user: TokenPayload = Depends(get_current_active_user)
    ) -> TokenPayload:
        """Require project manager or higher"""
        return require_role(UserRole.PROJECT_MANAGER)(current_user)
    
    @staticmethod
    async def require_estimator(
        current_user: TokenPayload = Depends(get_current_active_user)
    ) -> TokenPayload:
        """Require estimator or higher"""
        return require_role(UserRole.ESTIMATOR)(current_user)
    
    @staticmethod
    async def get_company_context(
        current_user: TokenPayload = Depends(get_current_active_user)
    ) -> dict:
        """Get company context for the current user"""
        return {
            "user_id": current_user.sub,
            "company_id": current_user.company_id,
            "user_role": current_user.role
        }


# Create dependencies instance
auth_deps = AuthDependencies()
