from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title='NETRA — Privacy-First Browser Agent Backend',
    version=settings.version,
    description=(
        'Judge-ready backend for PS 171. Accepts only sanitized browser context, '
        'plans safe browser actions, optionally delegates sanitized visual reasoning to an '
        'OpenAI-compatible Qwen-VL endpoint, and never accepts raw PII by design.'
    ),
    docs_url='/docs',
    redoc_url='/redoc',
)

origins = [x.strip() for x in settings.cors_origins.split(',') if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins != ['*'] else ['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(router)
