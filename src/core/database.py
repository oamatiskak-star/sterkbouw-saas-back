# backend/src/core/database.py
import uuid
from datetime import datetime
from typing import Optional, List
from supabase import create_client, Client
from pydantic import BaseModel, EmailStr, Field

from .config import settings


class DatabaseService:
    def __init__(self):
        self.client: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
        self.service_client: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
    
    async def test_connection(self) -> bool:
        try:
            # Simple query to test connection
            result = self.client.from_("users").select("count", count="exact").limit(1).execute()
            return True
        except Exception as e:
            print(f"Database connection failed: {e}")
            return False
    
    # User operations
    async def create_user(self, user_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("users").insert(user_data).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error creating user: {e}")
        return None
    
    async def get_user_by_email(self, email: str) -> Optional[dict]:
        try:
            result = self.client.table("users").select("*").eq("email", email).execute()
            if result.data:
                return result.data[0]
        except Exception:
            pass
        return None
    
    async def get_user_by_id(self, user_id: str) -> Optional[dict]:
        try:
            result = self.client.table("users").select("*").eq("id", user_id).execute()
            if result.data:
                return result.data[0]
        except Exception:
            pass
        return None
    
    async def update_user(self, user_id: str, update_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("users").update(update_data).eq("id", user_id).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error updating user: {e}")
        return None
    
    # Session operations
    async def create_session(self, session_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("sessions").insert(session_data).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error creating session: {e}")
        return None
    
    async def get_session(self, session_token: str) -> Optional[dict]:
        try:
            result = self.client.table("sessions").select("*").eq("token", session_token).execute()
            if result.data:
                return result.data[0]
        except Exception:
            pass
        return None
    
    async def delete_session(self, session_token: str) -> bool:
        try:
            self.client.table("sessions").delete().eq("token", session_token).execute()
            return True
        except Exception:
            return False
    
    async def delete_user_sessions(self, user_id: str) -> bool:
        try:
            self.client.table("sessions").delete().eq("user_id", user_id).execute()
            return True
        except Exception:
            return False
    
    # Company operations
    async def create_company(self, company_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("companies").insert(company_data).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error creating company: {e}")
        return None
    
    async def get_company_by_id(self, company_id: str) -> Optional[dict]:
        try:
            result = self.client.table("companies").select("*").eq("id", company_id).execute()
            if result.data:
                return result.data[0]
        except Exception:
            pass
        return None
    
    # Service client operations (for admin tasks)
    async def admin_get_user(self, user_id: str) -> Optional[dict]:
        try:
            result = self.service_client.table("users").select("*").eq("id", user_id).execute()
            if result.data:
                return result.data[0]
        except Exception:
            pass
        return None
    
    async def admin_update_user(self, user_id: str, update_data: dict) -> Optional[dict]:
        try:
            result = self.service_client.table("users").update(update_data).eq("id", user_id).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Admin error updating user: {e}")
        return None


# Initialize database service
database = DatabaseService()
