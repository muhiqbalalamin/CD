from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api import router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Mengizinkan semua akses (sangat penting untuk testing lokal)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)