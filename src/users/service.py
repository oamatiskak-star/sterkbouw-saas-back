# backend/src/users/service.py
from typing import List, Optional, Dict, Any
from datetime import datetime

from core.database import database
from core.models import UserUpdate, UserPublic, UserRole, UserStatus
from auth.security import security_service


class UserService:
    def __init__(self):
        self.db = database
    
    async def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user by ID"""
        return await self.db.get_user_by_id(user_id)
    
    async def update_user(self, user_id: str, update_data: UserUpdate, current_user_id: str) -> Optional[UserPublic]:
        """Update user profile"""
        try:
            # Only allow users to update their own profile or admins
            if user_id != current_user_id:
                # Check if current user has permission
                current_user = await self.db.get_user_by_id(current_user_id)
                if current_user.get("role") != UserRole.ADMIN.value:
                    return None
            
            # Prepare update data
            update_dict = update_data.dict(exclude_unset=True, exclude={"current_password", "new_password"})
            
            # Handle password change
            if update_data.current_password and update_data.new_password:
                user = await self.db.get_user_by_id(user_id)
                if not user:
                    return None
                
                # Verify current password
                if not security_service.verify_password(update_data.current_password, user["hashed_password"]):
                    return None
                
                # Hash new password
                hashed_password = security_service.get_password_hash(update_data.new_password)
                update_dict["hashed_password"] = hashed_password
            
            update_dict["updated_at"] = datetime.now().isoformat()
            
            # Update user
            updated_user = await self.db.update_user(user_id, update_dict)
            if not updated_user:
                return None
            
            # Convert to public model
            return UserPublic(
                id=updated_user["id"],
                email=updated_user["email"],
                first_name=updated_user["first_name"],
                last_name=updated_user["last_name"],
                role=UserRole(updated_user["role"]),
                status=UserStatus(updated_user["status"]),
                company_id=updated_user.get("company_id"),
                avatar_url=updated_user.get("avatar_url"),
                created_at=datetime.fromisoformat(updated_user["created_at"])
            )
            
        except Exception as e:
            print(f"Error updating user: {e}")
            return None
    
    async def delete_user(self, user_id: str, current_user_id: str) -> bool:
        """Delete user (soft delete)"""
        try:
            # Only allow users to delete their own account or admins
            if user_id != current_user_id:
                # Check if current user has permission
                current_user = await self.db.get_user_by_id(current_user_id)
                if current_user.get("role") != UserRole.ADMIN.value:
                    return False
            
            # Soft delete by updating status
            update_data = {
                "status": UserStatus.INACTIVE.value,
                "updated_at": datetime.now().isoformat()
            }
            
            updated = await self.db.update_user(user_id, update_data)
            return updated is not None
            
        except Exception:
            return False
    
    async def get_company_users(self, company_id: str, current_user: Dict[str, Any]) -> List[UserPublic]:
        """Get all users in a company"""
        try:
            # Check permissions
            if current_user.get("company_id") != company_id and current_user.get("role") != UserRole.ADMIN.value:
                return []
            
            # In production, implement proper query
            # For now, return empty list
            return []
            
        except Exception:
            return []
    
    async def update_user_role(self, user_id: str, new_role: UserRole, current_user_id: str) -> bool:
        """Update user role (admin only)"""
        try:
            # Check if current user is admin
            current_user = await self.db.get_user_by_id(current_user_id)
            if current_user.get("role") != UserRole.ADMIN.value:
                return False
            
            update_data = {
                "role": new_role.value,
                "updated_at": datetime.now().isoformat()
            }
            
            updated = await self.db.update_user(user_id, update_data)
            return updated is not None
            
        except Exception:
            return False


# Create user service instance
user_service = UserService()
