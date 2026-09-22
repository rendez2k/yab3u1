@echo off
setlocal
cd /d "%~dp0"

if not exist "web\index.html" (
  echo Run this from the project folder - web\index.html was not found.
  pause
  exit /b 1
)

echo.
echo Deploying web\ to Netlify.
echo The first run asks you to log in and pick the yab3u1 site; after that it
echo just deploys.
echo.

call npx --yes netlify deploy --prod --dir web
if errorlevel 1 (
  echo.
  echo Deploy failed - see the message above.
  echo If it says it is not linked, run:  npx netlify link
  pause
  exit /b 1
)

echo.
echo Done. Open the site and check the badge next to the title reads v1.1.0.
echo If it still reads an older version, hard refresh with Ctrl+Shift+R.
pause
