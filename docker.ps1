# docker.ps1 - Helper script to run the Docker environment
Write-Host "Starting Open Poll Docker environment..." -ForegroundColor Cyan

# Check if docker-compose is installed
if (!(Get-Command "docker-compose" -ErrorAction SilentlyContinue)) {
    Write-Error "docker-compose is not installed. Please install Docker Desktop or docker-compose."
    exit
}

# Run docker-compose up with build
docker-compose up --build -d

Write-Host "Services are starting up!" -ForegroundColor Green
Write-Host "Frontend: http://localhost:3000"
Write-Host "Backend: http://localhost:5000"
Write-Host "Redis: localhost:6379"
Write-Host "MongoDB: Remote Atlas Instance"
