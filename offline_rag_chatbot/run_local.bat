@echo off
title Offline RAG Chatbot - Local Launcher
echo ========================================================
echo Starting Offline RAG Chatbot (Backend & Frontend)
echo ========================================================
echo.

:: Start Flask Backend on port 5000 in background
echo Starting Flask backend on http://localhost:5000 ...
start "RAG Backend (Flask)" /b python app.py

:: Wait 2 seconds for backend to initialize
timeout /t 2 /nobreak >nul

:: Start Frontend Server on port 3000
echo Starting Frontend web server on http://localhost:3000 ...
cd frontend
start "RAG Frontend (HTTP)" /b python -m http.server 3000
cd ..

:: Open Browser
echo Opening http://localhost:3000 in your browser...
start http://localhost:3000

echo.
echo ========================================================
echo Servers are running! Keep this window open.
echo Backend:  http://localhost:5000
echo Frontend: http://localhost:3000
echo ========================================================
echo.
pause
