# backend/src/main.py - COMPLETE EINDPRODUKT MET ALLE MODULES
import os
import logging
from contextlib import asynccontextmanager
from datetime import datetime

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from core.config import settings
from core.database import database
from auth.routes import router as auth_router
from users.routes import router as users_router
from projects.routes import router as projects_router
from billing.routes import router as billing_router
from billing.webhooks import router as webhook_router
from api.routes import router as api_router
from api.gateway import api_gateway_middleware, rate_limiter

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("backend.log")
    ]
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan manager for startup and shutdown events
    """
    # Startup
    logger.info("🚀 Starting SterkBouw SaaS Backend")
    
    try:
        # Test database connection
        connected = await database.test_connection()
        if not connected:
            logger.error("❌ Database connection failed")
            raise RuntimeError("Database connection failed")
        
        logger.info("✅ Database connected successfully")
        
        # Initialize rate limiter
        await rate_limiter.initialize()
        logger.info("✅ Rate limiter initialized")
        
        # Initialize billing service if Stripe is configured
        if settings.STRIPE_SECRET_KEY:
            from billing.service import billing_service
            logger.info("✅ Stripe billing initialized")
        
        yield
        
    except Exception as e:
        logger.error(f"❌ Startup failed: {e}")
        raise
        
    finally:
        # Shutdown
        logger.info("👋 Shutting down SterkBouw SaaS Backend")


# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    description="SterkBouw SaaS Backend - Construction Project Management, Billing & AI Integration",
    version=settings.APP_VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Add middleware - API Gateway FIRST
app.middleware("http")(api_gateway_middleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"] if settings.ENVIRONMENT == "development" else settings.BACKEND_CORS_ORIGINS
)

app.add_middleware(GZipMiddleware, minimum_size=1000)

# Include all routers
app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(users_router, prefix=settings.API_V1_STR)
app.include_router(projects_router, prefix=settings.API_V1_STR)
app.include_router(billing_router, prefix=settings.API_V1_STR)
app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(webhook_router)  # Webhook routes zonder prefix


@app.get("/")
async def root():
    """
    Root endpoint
    """
    billing_enabled = bool(settings.STRIPE_SECRET_KEY)
    
    return {
        "message": f"Welcome to {settings.APP_NAME}",
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
        "docs": "/docs",
        "api_v1": settings.API_V1_STR,
        "billing_enabled": billing_enabled,
        "endpoints": {
            "auth": f"{settings.API_V1_STR}/auth",
            "users": f"{settings.API_V1_STR}/users",
            "projects": f"{settings.API_V1_STR}/projects",
            "billing": f"{settings.API_V1_STR}/billing",
            "api": f"{settings.API_V1_STR}/api",
            "webhooks": "/stripe/webhook"
        }
    }


@app.get("/health")
async def health_check():
    """
    Health check endpoint
    """
    try:
        # Test database connection
        db_connected = await database.test_connection()
        
        # Check Stripe connection if configured
        stripe_connected = False
        if settings.STRIPE_SECRET_KEY:
            try:
                import stripe
                stripe.api_key = settings.STRIPE_SECRET_KEY
                stripe.Balance.retrieve()
                stripe_connected = True
            except Exception:
                stripe_connected = False
        
        # Check Redis connection for rate limiting
        redis_connected = False
        try:
            if settings.REDIS_URL:
                import redis.asyncio as redis
                redis_client = redis.from_url(settings.REDIS_URL)
                await redis_client.ping()
                await redis_client.close()
                redis_connected = True
        except Exception:
            redis_connected = False
        
        services_status = {
            "database": "connected" if db_connected else "disconnected",
            "redis": "connected" if redis_connected else "disconnected",
            "stripe": "connected" if stripe_connected else "disconnected",
            "auth": "available",
            "users": "available",
            "projects": "available",
            "billing": "available" if settings.STRIPE_SECRET_KEY else "disabled",
            "api_gateway": "active"
        }
        
        # Determine overall status
        if not db_connected:
            overall_status = "unhealthy"
        elif settings.STRIPE_SECRET_KEY and not stripe_connected:
            overall_status = "degraded"
        elif settings.REDIS_URL and not redis_connected:
            overall_status = "degraded"
        else:
            overall_status = "healthy"
        
        return {
            "status": overall_status,
            "service": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "environment": settings.ENVIRONMENT,
            "timestamp": datetime.now().isoformat(),
            "services": services_status
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "service": settings.APP_NAME,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }


@app.get("/version")
async def version():
    """
    API version information
    """
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "api_version": "v1",
        "environment": settings.ENVIRONMENT,
        "modules": [
            {"name": "authentication", "version": "1.0.0"},
            {"name": "user_management", "version": "1.0.0"},
            {"name": "project_management", "version": "1.0.0"},
            {"name": "billing_payments", "version": "1.0.0"},
            {"name": "api_gateway", "version": "1.0.0"}
        ]
    }


@app.get("/status")
async def status():
    """
    Detailed status endpoint
    """
    try:
        # Get database status
        db_status = await database.test_connection()
        
        # Get Stripe status
        stripe_status = False
        stripe_error = None
        if settings.STRIPE_SECRET_KEY:
            try:
                import stripe
                stripe.api_key = settings.STRIPE_SECRET_KEY
                stripe.Balance.retrieve()
                stripe_status = True
            except Exception as e:
                stripe_error = str(e)
        
        # Get Redis status
        redis_status = False
        redis_error = None
        if settings.REDIS_URL:
            try:
                import redis.asyncio as redis
                redis_client = redis.from_url(settings.REDIS_URL)
                await redis_client.ping()
                await redis_client.close()
                redis_status = True
            except Exception as e:
                redis_error = str(e)
        
        # Get service info
        services = {
            "database": {
                "status": "online" if db_status else "offline",
                "connection": "established" if db_status else "failed"
            },
            "redis": {
                "status": "online" if redis_status else ("offline" if settings.REDIS_URL else "disabled"),
                "error": redis_error,
                "purpose": "rate_limiting"
            },
            "api_gateway": {
                "status": "online",
                "features": ["rate_limiting", "request_logging", "analytics", "api_key_management"]
            },
            "authentication": {
                "status": "online",
                "jwt_enabled": True,
                "session_management": True
            },
            "project_management": {
                "status": "online",
                "features": ["projects", "tasks", "documents", "team", "templates"]
            },
            "billing": {
                "status": "online" if settings.STRIPE_SECRET_KEY else "disabled",
                "stripe_connected": stripe_status,
                "stripe_error": stripe_error,
                "features": ["subscriptions", "invoices", "payments", "webhooks", "plans"]
            }
        }
        
        # Determine overall status
        if not db_status:
            overall_status = "error"
        elif settings.STRIPE_SECRET_KEY and not stripe_status:
            overall_status = "degraded"
        elif settings.REDIS_URL and not redis_status:
            overall_status = "degraded"
        else:
            overall_status = "operational"
        
        return {
            "status": overall_status,
            "timestamp": datetime.now().isoformat(),
            "services": services,
            "environment": settings.ENVIRONMENT,
            "version": settings.APP_VERSION
        }
        
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }


@app.get("/config")
async def config_info():
    """
    Configuration info (safe)
    """
    return {
        "app_name": settings.APP_NAME,
        "environment": settings.ENVIRONMENT,
        "api_version": "v1",
        "cors_origins": settings.BACKEND_CORS_ORIGINS,
        "features": {
            "authentication": True,
            "project_management": True,
            "billing": bool(settings.STRIPE_SECRET_KEY),
            "stripe_webhooks": bool(settings.STRIPE_WEBHOOK_SECRET),
            "rate_limiting": bool(settings.REDIS_URL),
            "api_key_management": True
        },
        "limits": {
            "rate_limit_per_minute": settings.RATE_LIMIT_PER_MINUTE,
            "access_token_expire_minutes": settings.ACCESS_TOKEN_EXPIRE_MINUTES,
            "refresh_token_expire_days": settings.REFRESH_TOKEN_EXPIRE_DAYS
        }
    }


# Error handlers
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "message": str(exc),
            "path": request.url.path,
            "method": request.method,
            "timestamp": datetime.now().isoformat(),
            "request_id": request.headers.get("X-Request-ID", "unknown")
        }
    )


# API Documentation metadata
@app.get("/openapi.json", include_in_schema=False)
async def get_openapi_schema():
    return app.openapi()


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("BACKEND_PORT", 8001)),
        reload=settings.ENVIRONMENT == "development",
        log_level="info",
        access_log=True,
        use_colors=True
    )
