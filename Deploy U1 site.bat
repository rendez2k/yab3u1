@echo off
setlocal
cd /d "%~dp0"

if not exist "web\index.html" (
  echo Run this from the project folder - web\index.html was not found.
  pause
  exit /b 1
)

echo.
echo Building the publishable site into dist\ ...
python tools\build_site.py
if errorlevel 1 (
  echo.
  echo Build failed - see the message above. Nothing was deployed.
  pause
  exit /b 1
)

echo.
echo Deploying dist\ to the yab3u1 site on Netlify.
echo The first run asks you to log in; after that it just deploys.
echo.

call npx --yes netlify deploy --prod --no-build --dir dist --site 9a37f1d8-ee76-4b19-ab7d-382277fb7850
if errorlevel 1 (
  echo.
  echo Deploy failed - see the message above.
  echo If it says it is not linked, run:
  echo   npx netlify link --id 9a37f1d8-ee76-4b19-ab7d-382277fb7850
  pause
  exit /b 1
)

echo.
echo Done. https://yab3u1.netlify.app should now serve the new build.
echo If the browser still shows the old page, hard refresh with Ctrl+Shift+R.
pause
