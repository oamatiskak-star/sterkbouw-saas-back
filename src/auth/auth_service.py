# backend/src/auth/auth_service.py
from datetime import datetime, timedelta
from typing import Optional, Tuple, Dict, Any
import uuid

from core.database import database
from core.config import settings
from core.models import (
    UserCreate, UserInDB, UserPublic, UserRole, UserStatus,
    Token, LoginRequest, CompanyCreate, CompanyInDB,
    PasswordResetRequest, EmailVerificationRequest
)
from .security import security_service


class AuthService:
    def __init__(self):
        self.db = database
    
    async def register(self, user_data: UserCreate) -> Tuple[Optional[UserPublic], Optional[str]]:
        """
        Register a new user and company
        
        Returns: (user_public, error_message)
        """
        try:
            # Check if user already exists
            existing_user = await self.db.get_user_by_email(user_data.email)
            if existing_user:
                return None, "User with this email already exists"
            
            # Create company if company_name is provided
            company_id = None
            if user_data.company_name:
                company = await self.db.create_company({
                    "id": str(uuid.uuid4()),
                    "name": user_data.company_name,
                    "company_type": user_data.company_type.value if user_data.company_type else "other",
                    "owner_id": None,  # Will be updated after user creation
                    "created_at": datetime.now().isoformat(),
                    "updated_at": datetime.now().isoformat()
                })
                
                if not company:
                    return None, "Failed to create company"
                company_id = company["id"]
            
            # Hash password
            hashed_password = security_service.get_password_hash(user_data.password)
            
            # Create user
            user_id = str(uuid.uuid4())
            user = await self.db.create_user({
                "id": user_id,
                "email": user_data.email,
                "first_name": user_data.first_name,
                "last_name": user_data.last_name,
                "phone": user_data.phone,
                "hashed_password": hashed_password,
                "role": UserRole.VIEWER.value,
                "status": UserStatus.PENDING.value if company_id else UserStatus.ACTIVE.value,
                "email_verified": False,
                "company_id": company_id,
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            })
            
            if not user:
                return None, "Failed to create user"
            
            # Update company with owner_id
            if company_id:
                await self.db.update_company(company_id, {"owner_id": user_id})
            
            # Create email verification token
            verification_token = security_service.generate_verification_token()
            
            # TODO: Send verification email
            # await self._send_verification_email(user_data.email, verification_token)
            
            # Convert to public user model
            user_public = UserPublic(
                id=user["id"],
                email=user["email"],
                first_name=user["first_name"],
                last_name=user["last_name"],
                role=UserRole(user["role"]),
                status=UserStatus(user["status"]),
                company_id=user["company_id"],
                created_at=datetime.fromisoformat(user["created_at"])
            )
            
            return user_public, None
            
        except Exception as e:
            return None, f"Registration failed: {str(e)}"
    
    async def login(self, login_data: LoginRequest, user_agent: Optional[str] = None, 
                   ip_address: Optional[str] = None) -> Tuple[Optional[Token], Optional[str]]:
        """
        Authenticate user
        
        Returns: (token_data, error_message)
        """
        try:
            # Get user by email
            user = await self.db.get_user_by_email(login_data.email)
            if not user:
                return None, "Invalid credentials"
            
            # Check password
            if not security_service.verify_password(login_data.password, user["hashed_password"]):
                return None, "Invalid credentials"
            
            # Check user status
            status = UserStatus(user["status"])
            if status == UserStatus.INACTIVE:
                return None, "Account is inactive"
            elif status == UserStatus.SUSPENDED:
                return None, "Account is suspended"
            elif status == UserStatus.PENDING:
                return None, "Account pending verification"
            
            # Create tokens
            token_data = {
                "sub": user["id"],
                "email": user["email"],
                "role": user["role"],
                "company_id": user.get("company_id")
            }
            
            access_token = security_service.create_access_token(token_data)
            
            if login_data.remember_me:
                refresh_token = security_service.create_refresh_token(token_data)
                # Store refresh token in database
                await self._create_session(
                    user_id=user["id"],
                    token=refresh_token,
                    user_agent=user_agent,
                    ip_address=ip_address,
                    expires_days=settings.REFRESH_TOKEN_EXPIRE_DAYS
                )
            else:
                refresh_token = security_service.create_refresh_token(token_data)
                # Short-lived refresh token
                await self._create_session(
                    user_id=user["id"],
                    token=refresh_token,
                    user_agent=user_agent,
                    ip_address=ip_address,
                    expires_days=1
                )
            
            token = Token(
                access_token=access_token,
                refresh_token=refresh_token,
                expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
            )
            
            return token, None
            
        except Exception as e:
            return None, f"Login failed: {str(e)}"
    
    async def refresh_token(self, refresh_token: str) -> Tuple[Optional[Token], Optional[str]]:
        """Refresh access token using refresh token"""
        try:
            # Verify refresh token
            payload = security_service.verify_token(refresh_token)
            if not payload:
                return None, "Invalid refresh token"
            
            # Check if token exists in database
            session = await self.db.get_session(refresh_token)
            if not session:
                return None, "Invalid refresh token"
            
            # Check if session is expired
            expires_at = datetime.fromisoformat(session["expires_at"])
            if expires_at < datetime.now():
                # Delete expired session
                await self.db.delete_session(refresh_token)
                return None, "Refresh token expired"
            
            # Get user
            user = await self.db.get_user_by_id(payload.sub)
            if not user:
                return None, "User not found"
            
            # Create new access token
            token_data = {
                "sub": user["id"],
                "email": user["email"],
                "role": user["role"],
                "company_id": user.get("company_id")
            }
            
            access_token = security_service.create_access_token(token_data)
            
            # Update session last used
            await self.db.update_session(refresh_token, {
                "last_used_at": datetime.now().isoformat()
            })
            
            token = Token(
                access_token=access_token,
                refresh_token=refresh_token,
                expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
            )
            
            return token, None
            
        except Exception as e:
            return None, f"Token refresh failed: {str(e)}"
    
    async def logout(self, refresh_token: str) -> bool:
        """Logout user by deleting session"""
        try:
            return await self.db.delete_session(refresh_token)
        except Exception:
            return False
    
    async def logout_all(self, user_id: str) -> bool:
        """Logout user from all devices"""
        try:
            return await self.db.delete_user_sessions(user_id)
        except Exception:
            return False
    
    async def verify_email(self, token: str) -> Tuple[bool, Optional[str]]:
        """Verify user email"""
        try:
            # TODO: Implement email verification logic
            # For now, just return success
            return True, None
        except Exception as e:
            return False, f"Email verification failed: {str(e)}"
    
    async def forgot_password(self, email: str) -> Tuple[bool, Optional[str]]:
        """Initiate password reset"""
        try:
            user = await self.db.get_user_by_email(email)
            if not user:
                # Don't reveal if user exists
                return True, None
            
            # Generate reset token
            reset_token = security_service.generate_password_reset_token()
            
            # Store token in database (with expiration)
            await self.db.create_password_reset_token({
                "user_id": user["id"],
                "token": reset_token,
                "expires_at": (datetime.now() + timedelta(hours=24)).isoformat(),
                "used": False
            })
            
            # TODO: Send password reset email
            # await self._send_password_reset_email(email, reset_token)
            
            return True, None
            
        except Exception as e:
            return False, f"Password reset request failed: {str(e)}"
    
    async def reset_password(self, token: str, new_password: str) -> Tuple[bool, Optional[str]]:
        """Reset password using token"""
        try:
            # TODO: Implement password reset logic
            # Get reset token from database
            # Verify it's valid and not expired
            # Update user password
            # Mark token as used
            
            return True, None
        except Exception as e:
            return False, f"Password reset failed: {str(e)}"
    
    async def change_password(self, user_id: str, current_password: str, new_password: str) -> Tuple[bool, Optional[str]]:
        """Change password for authenticated user"""
        try:
            user = await self.db.get_user_by_id(user_id)
            if not user:
                return False, "User not found"
            
            # Verify current password
            if not security_service.verify_password(current_password, user["hashed_password"]):
                return False, "Current password is incorrect"
            
            # Hash new password
            hashed_password = security_service.get_password_hash(new_password)
            
            # Update password
            updated = await self.db.update_user(user_id, {
                "hashed_password": hashed_password,
                "updated_at": datetime.now().isoformat()
            })
            
            if not updated:
                return False, "Failed to update password"
            
            # Logout user from all devices (optional)
            # await self.logout_all(user_id)
            
            return True, None
            
        except Exception as e:
            return False, f"Password change failed: {str(e)}"
    
    async def _create_session(self, user_id: str, token: str, user_agent: Optional[str], 
                            ip_address: Optional[str], expires_days: int) -> bool:
        """Create a new session in database"""
        try:
            expires_at = datetime.now() + timedelta(days=expires_days)
            
            session_data = {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "token": token,
                "user_agent": user_agent,
                "ip_address": ip_address,
                "expires_at": expires_at.isoformat(),
                "last_used_at": datetime.now().isoformat(),
                "created_at": datetime.now().isoformat()
            }
            
            session = await self.db.create_session(session_data)
            return session is not None
            
        except Exception:
            return False
    
    async def _send_verification_email(self, email: str, token: str):
        """Send email verification email"""
        # TODO: Implement email sending
        pass
    
    async def _send_password_reset_email(self, email: str, token: str):
        """Send password reset email"""
        # TODO: Implement email sending
        pass


# Create auth service instance
auth_service = AuthService()
