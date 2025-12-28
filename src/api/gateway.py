# backend/src/api/gateway.py
import time
from typing import Dict, List, Optional, Callable
from datetime import datetime, timedelta
from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
import redis.asyncio as redis
from collections import defaultdict

from core.config import settings
from core.database import database
from core.models import UserRole, SubscriptionPlan


class RateLimiter:
    """Rate limiting service"""
    
    def __init__(self):
        self.redis_client = None
        self.local_cache = defaultdict(list)
        
        # Rate limits per plan
        self.plan_limits = {
            SubscriptionPlan.FREE: {
                "requests_per_minute": 60,
                "requests_per_hour": 1000,
                "requests_per_day": 10000
            },
            SubscriptionPlan.BASIC: {
                "requests_per_minute": 120,
                "requests_per_hour": 5000,
                "requests_per_day": 50000
            },
            SubscriptionPlan.PROFESSIONAL: {
                "requests_per_minute": 300,
                "requests_per_hour": 20000,
                "requests_per_day": 200000
            },
            SubscriptionPlan.ENTERPRISE: {
                "requests_per_minute": 1000,
                "requests_per_hour": 100000,
                "requests_per_day": 1000000
            }
        }
    
    async def initialize(self):
        """Initialize Redis connection"""
        try:
            if settings.REDIS_URL:
                self.redis_client = redis.from_url(
                    settings.REDIS_URL,
                    encoding="utf-8",
                    decode_responses=True
                )
                await self.redis_client.ping()
                print("✅ Redis connected for rate limiting")
        except Exception as e:
            print(f"Redis connection failed: {e}")
            self.redis_client = None
    
    async def check_rate_limit(self, user_id: str, plan: SubscriptionPlan, 
                              endpoint: str) -> Dict[str, any]:
        """
        Check if user has exceeded rate limits
        
        Returns: {
            "allowed": bool,
            "remaining": int,
            "reset_time": int
        }
        """
        try:
            limits = self.plan_limits.get(plan, self.plan_limits[SubscriptionPlan.FREE])
            
            if self.redis_client:
                # Use Redis for distributed rate limiting
                return await self._check_redis_rate_limit(user_id, limits, endpoint)
            else:
                # Use local cache for development
                return await self._check_local_rate_limit(user_id, limits, endpoint)
                
        except Exception as e:
            print(f"Rate limit check failed: {e}")
            # Fail open in case of errors
            return {
                "allowed": True,
                "remaining": 1000,
                "reset_time": int(time.time()) + 60
            }
    
    async def _check_redis_rate_limit(self, user_id: str, limits: Dict, 
                                     endpoint: str) -> Dict[str, any]:
        """Redis-based rate limiting"""
        now = int(time.time())
        minute_key = f"rate_limit:{user_id}:{endpoint}:minute:{now // 60}"
        hour_key = f"rate_limit:{user_id}:{endpoint}:hour:{now // 3600}"
        day_key = f"rate_limit:{user_id}:{endpoint}:day:{now // 86400}"
        
        # Increment counters
        minute_count = await self.redis_client.incr(minute_key)
        hour_count = await self.redis_client.incr(hour_key)
        day_count = await self.redis_client.incr(day_key)
        
        # Set expiry
        if minute_count == 1:
            await self.redis_client.expire(minute_key, 60)
        if hour_count == 1:
            await self.redis_client.expire(hour_key, 3600)
        if day_count == 1:
            await self.redis_client.expire(day_key, 86400)
        
        # Check limits
        allowed = (
            minute_count <= limits["requests_per_minute"] and
            hour_count <= limits["requests_per_hour"] and
            day_count <= limits["requests_per_day"]
        )
        
        return {
            "allowed": allowed,
            "remaining": max(0, limits["requests_per_minute"] - minute_count),
            "reset_time": ((now // 60) + 1) * 60
        }
    
    async def _check_local_rate_limit(self, user_id: str, limits: Dict, 
                                     endpoint: str) -> Dict[str, any]:
        """Local cache rate limiting"""
        now = time.time()
        key = f"{user_id}:{endpoint}"
        
        # Clean old entries
        self.local_cache[key] = [
            timestamp for timestamp in self.local_cache[key]
            if now - timestamp < 60
        ]
        
        # Add current request
        self.local_cache[key].append(now)
        
        # Check limit
        minute_count = len(self.local_cache[key])
        allowed = minute_count <= limits["requests_per_minute"]
        
        return {
            "allowed": allowed,
            "remaining": max(0, limits["requests_per_minute"] - minute_count),
            "reset_time": int(now) + 60
        }


class RequestLogger:
    """Request logging for analytics"""
    
    def __init__(self):
        self.db = database
    
    async def log_request(self, request: Request, user_id: Optional[str], 
                         company_id: Optional[str], response_status: int,
                         processing_time: float):
        """Log API request for analytics"""
        try:
            log_data = {
                "method": request.method,
                "path": request.url.path,
                "query_params": str(request.query_params),
                "user_id": user_id,
                "company_id": company_id,
                "response_status": response_status,
                "processing_time_ms": int(processing_time * 1000),
                "user_agent": request.headers.get("user-agent", ""),
                "ip_address": request.client.host if request.client else None,
                "timestamp": datetime.now().isoformat()
            }
            
            # In production, this would go to a analytics database
            # For now, just print
            if settings.ENVIRONMENT == "development":
                print(f"📊 API Request: {log_data}")
            
            # Store in database
            await self.db.create_request_log(log_data)
            
        except Exception as e:
            print(f"Error logging request: {e}")


class APIKeyManager:
    """API Key management for external integrations"""
    
    def __init__(self):
        self.db = database
    
    async def validate_api_key(self, api_key: str) -> Optional[Dict]:
        """Validate API key and return associated company/user"""
        try:
            # Get API key from database
            api_key_record = await self.db.get_api_key(api_key)
            if not api_key_record:
                return None
            
            # Check if active
            if not api_key_record.get("is_active", False):
                return None
            
            # Check expiry
            expires_at = api_key_record.get("expires_at")
            if expires_at and datetime.fromisoformat(expires_at) < datetime.now():
                return None
            
            # Update last used
            await self.db.update_api_key_last_used(api_key_record["id"])
            
            return {
                "company_id": api_key_record.get("company_id"),
                "user_id": api_key_record.get("created_by"),
                "permissions": api_key_record.get("permissions", {}),
                "rate_limit": api_key_record.get("rate_limit_per_minute", 60)
            }
            
        except Exception as e:
            print(f"Error validating API key: {e}")
            return None
    
    async def create_api_key(self, company_id: str, user_id: str, 
                           name: str, permissions: Dict, 
                           rate_limit: int = 60) -> Optional[str]:
        """Create new API key"""
        try:
            import secrets
            
            # Generate key
            api_key = f"sk_{secrets.token_urlsafe(32)}"
            
            # Store in database
            key_data = {
                "id": f"key_{secrets.token_urlsafe(16)}",
                "key_hash": api_key,  # In production, hash this
                "name": name,
                "company_id": company_id,
                "created_by": user_id,
                "permissions": permissions,
                "rate_limit_per_minute": rate_limit,
                "is_active": True,
                "created_at": datetime.now().isoformat()
            }
            
            created = await self.db.create_api_key(key_data)
            if created:
                return api_key
            
            return None
            
        except Exception as e:
            print(f"Error creating API key: {e}")
            return None


class AnalyticsService:
    """Analytics and metrics collection"""
    
    def __init__(self):
        self.db = database
    
    async def get_company_metrics(self, company_id: str, 
                                 period: str = "day") -> Dict[str, any]:
        """Get usage metrics for company"""
        try:
            # Calculate period
            now = datetime.now()
            if period == "hour":
                start_time = now - timedelta(hours=1)
            elif period == "day":
                start_time = now - timedelta(days=1)
            elif period == "week":
                start_time = now - timedelta(weeks=1)
            elif period == "month":
                start_time = now - timedelta(days=30)
            else:
                start_time = now - timedelta(days=1)
            
            # Get metrics from database
            metrics = await self.db.get_company_metrics(
                company_id, 
                start_time.isoformat(), 
                now.isoformat()
            )
            
            return {
                "period": period,
                "start_time": start_time.isoformat(),
                "end_time": now.isoformat(),
                "total_requests": metrics.get("total_requests", 0),
                "successful_requests": metrics.get("successful_requests", 0),
                "failed_requests": metrics.get("failed_requests", 0),
                "average_response_time": metrics.get("avg_response_time", 0),
                "endpoint_usage": metrics.get("endpoint_usage", {}),
                "user_activity": metrics.get("user_activity", {}),
                "storage_used_mb": metrics.get("storage_used", 0),
                "api_calls_remaining": metrics.get("api_calls_remaining", 0)
            }
            
        except Exception as e:
            print(f"Error getting company metrics: {e}")
            return {}
    
    async def record_event(self, company_id: str, event_type: str, 
                          event_data: Dict[str, any]):
        """Record custom event for analytics"""
        try:
            event = {
                "id": f"event_{int(time.time())}_{hash(str(event_data)) % 10000:04d}",
                "company_id": company_id,
                "event_type": event_type,
                "event_data": event_data,
                "timestamp": datetime.now().isoformat()
            }
            
            await self.db.create_analytics_event(event)
            
        except Exception as e:
            print(f"Error recording event: {e}")


# Initialize services
rate_limiter = RateLimiter()
request_logger = RequestLogger()
api_key_manager = APIKeyManager()
analytics_service = AnalyticsService()


# Middleware
async def api_gateway_middleware(request: Request, call_next):
    """
    API Gateway middleware for rate limiting, logging, etc.
    """
    start_time = time.time()
    
    try:
        # Extract user/company info from request
        user_id = None
        company_id = None
        plan = SubscriptionPlan.FREE
        
        # Check for API key in header
        api_key = request.headers.get("X-API-Key")
        if api_key:
            api_key_info = await api_key_manager.validate_api_key(api_key)
            if api_key_info:
                company_id = api_key_info.get("company_id")
                user_id = api_key_info.get("user_id")
                # API keys have basic plan limits
                plan = SubscriptionPlan.BASIC
        else:
            # Check for JWT token
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                # In production, decode JWT to get user info
                # For now, extract from path or query params
                pass
        
        # Get company subscription for rate limiting
        if company_id:
            from billing.service import billing_service
            subscription = await billing_service.get_company_subscription(company_id)
            if subscription:
                plan = subscription.plan_type
        
        # Rate limiting
        if user_id and not request.url.path.startswith("/stripe/webhook"):
            rate_limit_result = await rate_limiter.check_rate_limit(
                user_id or f"ip_{request.client.host}",
                plan,
                request.url.path
            )
            
            if not rate_limit_result["allowed"]:
                return JSONResponse(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    content={
                        "error": "Rate limit exceeded",
                        "remaining": rate_limit_result["remaining"],
                        "reset_time": rate_limit_result["reset_time"]
                    },
                    headers={
                        "X-RateLimit-Limit": str(rate_limiter.plan_limits[plan]["requests_per_minute"]),
                        "X-RateLimit-Remaining": str(rate_limit_result["remaining"]),
                        "X-RateLimit-Reset": str(rate_limit_result["reset_time"])
                    }
                )
        
        # Process request
        response = await call_next(request)
        processing_time = time.time() - start_time
        
        # Log request
        await request_logger.log_request(
            request, user_id, company_id, 
            response.status_code, processing_time
        )
        
        # Add rate limit headers to response
        if user_id:
            response.headers["X-RateLimit-Limit"] = str(rate_limiter.plan_limits[plan]["requests_per_minute"])
            response.headers["X-RateLimit-Remaining"] = str(rate_limit_result.get("remaining", 0))
            response.headers["X-RateLimit-Reset"] = str(rate_limit_result.get("reset_time", 0))
        
        return response
        
    except Exception as e:
        processing_time = time.time() - start_time
        await request_logger.log_request(
            request, user_id, company_id, 
            500, processing_time
        )
        raise e
