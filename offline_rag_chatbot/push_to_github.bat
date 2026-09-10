@echo off
title Push to GitHub
set "PATH=C:\Users\acer\AppData\Local\Programs\Git\cmd;C:\Users\acer\AppData\Local\Programs\Git\bin;%PATH%"

echo ========================================================
echo Pushing Offline RAG Chatbot to GitHub
echo Remote: https://github.com/abisheksanthu-source/offline-rag-chatbot.git
echo ========================================================
echo.
echo If prompted for password, enter your GitHub Personal Access Token.
echo.

git push -u origin main

echo.
echo ========================================================
pause
