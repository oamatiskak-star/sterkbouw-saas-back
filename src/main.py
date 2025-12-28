# backend/src/main.py
import os
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from core.config import settings
from core.database import database
from auth.routes import router as auth_router
from users.routes import router as users_router
from projects.routes import router as projects_router  # Nieuwe import

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
    description="SterkBouw SaaS Backend - Construction Project Management",
    version=settings.APP_VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Add middleware
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

# Include routers
app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(users_router, prefix=settings.API_V1_STR)
app.include_router(projects_router, prefix=settings.API_V1_STR)  # Nieuwe router toegevoegd


@app.get("/")
async def root():
    """
    Root endpoint
    """
    return {
        "message": f"Welcome to {settings.APP_NAME}",
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
        "docs": "/docs",
        "api_v1": settings.API_V1_STR,
        "endpoints": {
            "auth": f"{settings.API_V1_STR}/auth",
            "users": f"{settings.API_V1_STR}/users",
            "projects": f"{settings.API_V1_STR}/projects"
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
        
        return {
            "status": "healthy" if db_connected else "degraded",
            "service": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "environment": settings.ENVIRONMENT,
            "timestamp": datetime.now().isoformat(),
            "database": "connected" if db_connected else "disconnected",
            "services": {
                "auth": "available",
                "users": "available",
                "projects": "available"
            }
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
            {"name": "project_management", "version": "1.0.0"}
        ]
    }


@app.get("/status")
async def status():
    """
    Detailed status endpoint
    """
    from datetime import datetime
    
    try:
        # Get database status
        db_status = await database.test_connection()
        
        # Get service info
        services = {
            "database": {
                "status": "online" if db_status else "offline",
                "connection": "established" if db_status else "failed"
            },
            "api": {
                "status": "online",
                "uptime": "0s",  # Would need to track uptime
                "requests": 0  # Would need to track metrics
            },
            "authentication": {
                "status": "online",
                "jwt_enabled": True,
                "session_management": True
            },
            "project_management": {
                "status": "online",
                "features": ["projects", "tasks", "documents", "team"]
            }
        }
        
        return {
            "status": "operational" if db_status else "degraded",
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


# Error handlers
from fastapi import Request
from fastapi.responses import JSONResponse
from datetime import datetime

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
            "timestamp": datetime.now().isoformat()
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
