# backend/src/core/database.py
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from supabase import create_client, Client
from pydantic import BaseModel, EmailStr, Field

from .config import settings


class DatabaseService:
    def __init__(self):
        self.client: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
        self.service_client: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
    
    async def test_connection(self) -> bool:
        """Test database connection"""
        try:
            result = self.client.from_("users").select("count", count="exact").limit(1).execute()
            return True
        except Exception as e:
            print(f"Database connection failed: {e}")
            return False
    
    # ==================== USER OPERATIONS ====================
    
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
    
    # ==================== COMPANY OPERATIONS ====================
    
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
    
    async def update_company(self, company_id: str, update_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("companies").update(update_data).eq("id", company_id).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error updating company: {e}")
        return None
    
    # ==================== SESSION OPERATIONS ====================
    
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
    
    async def update_session(self, session_token: str, update_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("sessions").update(update_data).eq("token", session_token).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error updating session: {e}")
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
    
    # ==================== PASSWORD RESET OPERATIONS ====================
    
    async def create_password_reset_token(self, token_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("password_reset_tokens").insert(token_data).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error creating password reset token: {e}")
        return None
    
    async def get_password_reset_token(self, token: str) -> Optional[dict]:
        try:
            result = self.client.table("password_reset_tokens").select("*").eq("token", token).execute()
            if result.data:
                return result.data[0]
        except Exception:
            pass
        return None
    
    async def update_password_reset_token(self, token: str, update_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("password_reset_tokens").update(update_data).eq("token", token).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error updating password reset token: {e}")
        return None
    
    # ==================== PROJECT OPERATIONS ====================
    
    async def create_project(self, project_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("projects").insert(project_data).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error creating project: {e}")
        return None
    
    async def get_project_by_id(self, project_id: str) -> Optional[dict]:
        try:
            result = self.client.table("projects").select("*").eq("id", project_id).execute()
            if result.data:
                return result.data[0]
        except Exception:
            pass
        return None
    
    async def update_project(self, project_id: str, update_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("projects").update(update_data).eq("id", project_id).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error updating project: {e}")
        return None
    
    async def search_projects(self, filters: dict, page: int = 1, limit: int = 20, 
                            sort_by: str = "updated_at", sort_order: str = "desc") -> List[dict]:
        try:
            query = self.client.table("projects").select("*")
            
            # Apply filters
            if "status" in filters:
                query = query.in_("status", filters["status"])
            if "project_type" in filters:
                query = query.in_("project_type", filters["project_type"])
            if "priority" in filters:
                query = query.in_("priority", filters["priority"])
            if "company_id" in filters:
                query = query.eq("company_id", filters["company_id"])
            if "created_by" in filters:
                query = query.eq("created_by", filters["created_by"])
            if "tags" in filters:
                for tag in filters["tags"]:
                    query = query.contains("tags", [tag])
            if "search" in filters:
                query = query.or_(f"name.ilike.%{filters['search']}%,description.ilike.%{filters['search']}%")
            
            # Date filters
            if "start_date_from" in filters:
                query = query.gte("start_date", filters["start_date_from"].isoformat())
            if "start_date_to" in filters:
                query = query.lte("start_date", filters["start_date_to"].isoformat())
            if "end_date_from" in filters:
                query = query.gte("end_date", filters["end_date_from"].isoformat())
            if "end_date_to" in filters:
                query = query.lte("end_date", filters["end_date_to"].isoformat())
            
            # Apply sorting
            if sort_order.lower() == "desc":
                query = query.order(sort_by, desc=True)
            else:
                query = query.order(sort_by)
            
            # Apply pagination
            start = (page - 1) * limit
            query = query.range(start, start + limit - 1)
            
            result = query.execute()
            return result.data if result.data else []
            
        except Exception as e:
            print(f"Error searching projects: {e}")
            return []
    
    async def count_projects(self, filters: dict) -> int:
        try:
            query = self.client.table("projects").select("id", count="exact")
            
            # Apply filters
            if "status" in filters:
                query = query.in_("status", filters["status"])
            if "project_type" in filters:
                query = query.in_("project_type", filters["project_type"])
            if "search" in filters:
                query = query.or_(f"name.ilike.%{filters['search']}%,description.ilike.%{filters['search']}%")
            
            result = query.execute()
            return result.count if result.count else 0
            
        except Exception as e:
            print(f"Error counting projects: {e}")
            return 0
    
    async def get_user_projects(self, user_id: str, limit: int = 10) -> List[dict]:
        """Get projects where user is a team member"""
        try:
            # Get project IDs from team members table
            team_result = self.client.table("team_members").select("project_id").eq("user_id", user_id).execute()
            project_ids = [tm["project_id"] for tm in team_result.data] if team_result.data else []
            
            if not project_ids:
                return []
            
            # Get projects
            result = self.client.table("projects").select("*").in_("id", project_ids)\
                .order("updated_at", desc=True).limit(limit).execute()
            
            return result.data if result.data else []
            
        except Exception as e:
            print(f"Error getting user projects: {e}")
            return []
    
    async def get_user_recent_projects(self, user_id: str, limit: int = 5) -> List[dict]:
        """Get user's recent projects"""
        try:
            return await self.get_user_projects(user_id, limit)
        except Exception as e:
            print(f"Error getting recent projects: {e}")
            return []
    
    async def increment_project_team_count(self, project_id: str) -> bool:
        """Increment project team member count"""
        try:
            # Get current count
            project = await self.get_project_by_id(project_id)
            if not project:
                return False
            
            current_count = project.get("team_member_count", 0)
            result = self.client.table("projects").update({
                "team_member_count": current_count + 1,
                "updated_at": datetime.now().isoformat()
            }).eq("id", project_id).execute()
            
            return result.data is not None
            
        except Exception as e:
            print(f"Error incrementing team count: {e}")
            return False
    
    async def decrement_project_team_count(self, project_id: str) -> bool:
        """Decrement project team member count"""
        try:
            project = await self.get_project_by_id(project_id)
            if not project:
                return False
            
            current_count = project.get("team_member_count", 1)
            new_count = max(0, current_count - 1)
            
            result = self.client.table("projects").update({
                "team_member_count": new_count,
                "updated_at": datetime.now().isoformat()
            }).eq("id", project_id).execute()
            
            return result.data is not None
            
        except Exception as e:
            print(f"Error decrementing team count: {e}")
            return False
    
    async def increment_project_document_count(self, project_id: str) -> bool:
        """Increment project document count"""
        try:
            project = await self.get_project_by_id(project_id)
            if not project:
                return False
            
            current_count = project.get("document_count", 0)
            result = self.client.table("projects").update({
                "document_count": current_count + 1,
                "updated_at": datetime.now().isoformat()
            }).eq("id", project_id).execute()
            
            return result.data is not None
            
        except Exception as e:
            print(f"Error incrementing document count: {e}")
            return False
    
    async def increment_project_task_count(self, project_id: str) -> bool:
        """Increment project task count"""
        try:
            project = await self.get_project_by_id(project_id)
            if not project:
                return False
            
            current_count = project.get("task_count", 0)
            result = self.client.table("projects").update({
                "task_count": current_count + 1,
                "updated_at": datetime.now().isoformat()
            }).eq("id", project_id).execute()
            
            return result.data is not None
            
        except Exception as e:
            print(f"Error incrementing task count: {e}")
            return False
    
    async def increment_project_calculation_count(self, project_id: str) -> bool:
        """Increment project calculation count"""
        try:
            project = await self.get_project_by_id(project_id)
            if not project:
                return False
            
            current_count = project.get("calculation_count", 0)
            result = self.client.table("projects").update({
                "calculation_count": current_count + 1,
                "updated_at": datetime.now().isoformat()
            }).eq("id", project_id).execute()
            
            return result.data is not None
            
        except Exception as e:
            print(f"Error incrementing calculation count: {e}")
            return False
    
    # ==================== TEAM MEMBER OPERATIONS ====================
    
    async def create_team_member(self, team_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("team_members").insert(team_data).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error creating team member: {e}")
        return None
    
    async def get_team_member(self, project_id: str, user_id: str) -> Optional[dict]:
        try:
            result = self.client.table("team_members").select("*")\
                .eq("project_id", project_id).eq("user_id", user_id).execute()
            if result.data:
                return result.data[0]
        except Exception:
            pass
        return None
    
    async def get_team_member_by_id(self, member_id: str) -> Optional[dict]:
        try:
            result = self.client.table("team_members").select("*").eq("id", member_id).execute()
            if result.data:
                return result.data[0]
        except Exception:
            pass
        return None
    
    async def get_project_team_members(self, project_id: str) -> List[dict]:
        try:
            # Join with users table
            result = self.client.table("team_members")\
                .select("*, users!inner(email, first_name, last_name, avatar_url)")\
                .eq("project_id", project_id).execute()
            
            return result.data if result.data else []
        except Exception as e:
            print(f"Error getting team members: {e}")
            return []
    
    async def update_team_member(self, member_id: str, update_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("team_members").update(update_data).eq("id", member_id).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error updating team member: {e}")
        return None
    
    async def delete_team_member(self, member_id: str) -> bool:
        try:
            self.client.table("team_members").delete().eq("id", member_id).execute()
            return True
        except Exception:
            return False
    
    async def get_project_owners(self, project_id: str) -> List[dict]:
        try:
            result = self.client.table("team_members").select("*")\
                .eq("project_id", project_id).eq("role", "owner").execute()
            return result.data if result.data else []
        except Exception:
            return []
    
    # ==================== DOCUMENT OPERATIONS ====================
    
    async def create_document(self, document_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("documents").insert(document_data).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error creating document: {e}")
        return None
    
    async def get_document_by_id(self, document_id: str) -> Optional[dict]:
        try:
            result = self.client.table("documents").select("*").eq("id", document_id).execute()
            if result.data:
                return result.data[0]
        except Exception:
            pass
        return None
    
    async def get_project_documents(self, project_id: str, document_type: Optional[str] = None, 
                                   page: int = 1, limit: int = 20) -> List[dict]:
        try:
            query = self.client.table("documents").select("*").eq("project_id", project_id)
            
            if document_type:
                query = query.eq("document_type", document_type)
            
            start = (page - 1) * limit
            result = query.order("created_at", desc=True).range(start, start + limit - 1).execute()
            
            return result.data if result.data else []
        except Exception as e:
            print(f"Error getting documents: {e}")
            return []
    
    async def count_project_documents(self, project_id: str, document_type: Optional[str] = None) -> int:
        try:
            query = self.client.table("documents").select("id", count="exact").eq("project_id", project_id)
            
            if document_type:
                query = query.eq("document_type", document_type)
            
            result = query.execute()
            return result.count if result.count else 0
        except Exception as e:
            print(f"Error counting documents: {e}")
            return 0
    
    async def update_document(self, document_id: str, update_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("documents").update(update_data).eq("id", document_id).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error updating document: {e}")
        return None
    
    async def update_document_analysis(self, document_id: str, analysis_result: dict) -> bool:
        try:
            result = self.client.table("documents").update({
                "analysis_result": analysis_result,
                "analysis_date": datetime.now().isoformat(),
                "status": "analyzed",
                "updated_at": datetime.now().isoformat()
            }).eq("id", document_id).execute()
            
            return result.data is not None
        except Exception as e:
            print(f"Error updating document analysis: {e}")
            return False
    
    # ==================== TASK OPERATIONS ====================
    
    async def create_task(self, task_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("tasks").insert(task_data).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error creating task: {e}")
        return None
    
    async def get_task_by_id(self, task_id: str) -> Optional[dict]:
        try:
            result = self.client.table("tasks").select("*").eq("id", task_id).execute()
            if result.data:
                return result.data[0]
        except Exception:
            pass
        return None
    
    async def get_project_tasks(self, project_id: str, status: Optional[str] = None, 
                               assigned_to: Optional[str] = None, page: int = 1, 
                               limit: int = 20) -> List[dict]:
        try:
            query = self.client.table("tasks").select("*").eq("project_id", project_id)
            
            if status:
                query = query.eq("status", status)
            if assigned_to:
                query = query.eq("assigned_to", assigned_to)
            
            start = (page - 1) * limit
            result = query.order("due_date").order("created_at", desc=True)\
                .range(start, start + limit - 1).execute()
            
            return result.data if result.data else []
        except Exception as e:
            print(f"Error getting tasks: {e}")
            return []
    
    async def count_project_tasks(self, project_id: str, status: Optional[str] = None, 
                                 assigned_to: Optional[str] = None) -> int:
        try:
            query = self.client.table("tasks").select("id", count="exact").eq("project_id", project_id)
            
            if status:
                query = query.eq("status", status)
            if assigned_to:
                query = query.eq("assigned_to", assigned_to)
            
            result = query.execute()
            return result.count if result.count else 0
        except Exception as e:
            print(f"Error counting tasks: {e}")
            return 0
    
    async def get_user_assigned_tasks(self, user_id: str, limit: int = 10) -> List[dict]:
        try:
            result = self.client.table("tasks").select("*").eq("assigned_to", user_id)\
                .neq("status", "completed").order("due_date").limit(limit).execute()
            
            return result.data if result.data else []
        except Exception as e:
            print(f"Error getting assigned tasks: {e}")
            return []
    
    async def get_user_overdue_tasks(self, user_id: str) -> List[dict]:
        try:
            from datetime import datetime
            today = datetime.now().isoformat()
            
            result = self.client.table("tasks").select("*")\
                .eq("assigned_to", user_id).neq("status", "completed")\
                .lt("due_date", today).order("due_date").execute()
            
            return result.data if result.data else []
        except Exception as e:
            print(f"Error getting overdue tasks: {e}")
            return []
    
    async def update_task(self, task_id: str, update_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("tasks").update(update_data).eq("id", task_id).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error updating task: {e}")
        return None
    
    # ==================== CALCULATION OPERATIONS ====================
    
    async def create_calculation(self, calculation_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("calculations").insert(calculation_data).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error creating calculation: {e}")
        return None
    
    async def get_calculation(self, calculation_id: str) -> Optional[dict]:
        try:
            result = self.client.table("calculations").select("*").eq("id", calculation_id).execute()
            if result.data:
                return result.data[0]
        except Exception:
            pass
        return None
    
    async def get_project_calculations(self, project_id: str) -> List[dict]:
        try:
            result = self.client.table("calculations").select("*")\
                .eq("project_id", project_id).order("created_at", desc=True).execute()
            
            return result.data if result.data else []
        except Exception as e:
            print(f"Error getting calculations: {e}")
            return []
    
    async def update_calculation(self, calculation_id: str, update_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("calculations").update(update_data).eq("id", calculation_id).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error updating calculation: {e}")
        return None
    
    # ==================== TEMPLATE OPERATIONS ====================
    
    async def create_project_template(self, template_data: dict) -> Optional[dict]:
        try:
            result = self.client.table("project_templates").insert(template_data).execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            print(f"Error creating project template: {e}")
        return None
    
    async def get_project_template(self, template_id: str) -> Optional[dict]:
        try:
            result = self.client.table("project_templates").select("*").eq("id", template_id).execute()
            if result.data:
                return result.data[0]
        except Exception:
            pass
        return None
    
    async def get_company_templates(self, company_id: str, is_public: Optional[bool] = None) -> List[dict]:
        try:
            query = self.client.table("project_templates").select("*")
            
            if is_public is not None:
                if is_public:
                    query = query.eq("is_public", True)
                else:
                    query = query.or_(f"company_id.eq.{company_id},is_public.eq.true")
            else:
                query = query.eq("company_id", company_id)
            
            result = query.order("used_count", desc=True).execute()
            return result.data if result.data else []
        except Exception as e:
            print(f"Error getting templates: {e}")
            return []
    
    async def increment_template_usage(self, template_id: str) -> bool:
        try:
            # Get current count
            template = await self.get_project_template(template_id)
            if not template:
                return False
            
            current_count = template.get("used_count", 0)
            result = self.client.table("project_templates").update({
                "used_count": current_count + 1,
                "updated_at": datetime.now().isoformat()
            }).eq("id", template_id).execute()
            
            return result.data is not None
            
        except Exception as e:
            print(f"Error incrementing template usage: {e}")
            return False
    
    # ==================== STATISTICS OPERATIONS ====================
    
    async def get_company_project_stats(self, company_id: str) -> Optional[dict]:
        try:
            # Get total projects
            total_result = self.client.table("projects").select("id", count="exact")\
                .eq("company_id", company_id).neq("status", "archived").execute()
            
            # Get active projects
            active_result = self.client.table("projects").select("id", count="exact")\
                .eq("company_id", company_id).eq("status", "active").execute()
            
            # Get completed projects
            completed_result = self.client.table("projects").select("id", count="exact")\
                .eq("company_id", company_id).eq("status", "completed").execute()
            
            # Get documents count
            docs_result = self.client.table("documents").select("id", count="exact")\
                .eq("company_id", company_id).execute()
            
            # Get tasks count
            tasks_result = self.client.table("tasks").select("id", count="exact")\
                .eq("company_id", company_id).execute()
            
            # Get overdue tasks
            from datetime import datetime
            today = datetime.now().isoformat()
            overdue_result = self.client.table("tasks").select("id", count="exact")\
                .eq("company_id", company_id).neq("status", "completed")\
                .lt("due_date", today).execute()
            
            # Get total budget
            budget_result = self.client.table("projects").select("budget")\
                .eq("company_id", company_id).neq("status", "archived").execute()
            
            total_budget = sum(p.get("budget", 0) for p in budget_result.data) if budget_result.data else 0
            
            # Note: spent_budget would require invoice/payment data
            spent_budget = 0
            
            return {
                "total_projects": total_result.count or 0,
                "active_projects": active_result.count or 0,
                "completed_projects": completed_result.count or 0,
                "total_documents": docs_result.count or 0,
                "total_tasks": tasks_result.count or 0,
                "overdue_tasks": overdue_result.count or 0,
                "total_budget": total_budget,
                "spent_budget": spent_budget
            }
            
        except Exception as e:
            print(f"Error getting company stats: {e}")
            return None
    
    # ==================== ADMIN OPERATIONS ====================
    
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
    
    async def admin_get_all_users(self, page: int = 1, limit: int = 20) -> List[dict]:
        try:
            start = (page - 1) * limit
            result = self.service_client.table("users").select("*")\
                .order("created_at", desc=True).range(start, start + limit - 1).execute()
            return result.data if result.data else []
        except Exception as e:
            print(f"Admin error getting users: {e}")
            return []
    
    async def admin_count_users(self) -> int:
        try:
            result = self.service_client.table("users").select("id", count="exact").execute()
            return result.count if result.count else 0
        except Exception as e:
            print(f"Admin error counting users: {e}")
            return 0


# Initialize database service
database = DatabaseService()
