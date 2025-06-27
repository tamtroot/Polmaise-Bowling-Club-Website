# PowerShell script to delete files with "-thumbs-thumbs" in their name
# This script will recursively search through all subdirectories
#
# Usage: Just run .\thumbdelete.ps1
# To test without deleting: .\thumbdelete.ps1 -WhatIf
# To skip confirmation: .\thumbdelete.ps1 -Force

# Set your root path here - change this to the directory you want to clean
$rootPath = "C:\Users\thoma\OneDrive\Documents\Py\Web\PolmaiseBC\Images\2025\BridgeTea"  # Set your root path here

param(
    [Parameter(HelpMessage="Show what files would be deleted without actually deleting them")]
    [switch]$WhatIf,
    
    [Parameter(HelpMessage="Delete files without confirmation prompt")]
    [switch]$Force
)

# Validate the path exists
if (-not (Test-Path -Path $Path)) {
    Write-Host "Error: The specified path '$Path' does not exist." -ForegroundColor Red
    exit 1
}

# Convert to absolute path for clearer output
$absolutePath = Resolve-Path -Path $Path
Write-Host "Searching for files with '-thumbs-thumbs' in their name..." -ForegroundColor Yellow
Write-Host "Search directory: $absolutePath" -ForegroundColor Cyan

# Get all files recursively that contain "-thumbs-thumbs" in their name
$filesToDelete = Get-ChildItem -Path $Path -Recurse -File | Where-Object { $_.Name -like "*-thumbs-thumbs*" }

if ($filesToDelete.Count -eq 0) {
    Write-Host "No files found with '-thumbs-thumbs' in their name." -ForegroundColor Green
    exit 0
}

Write-Host "Found $($filesToDelete.Count) files to delete:" -ForegroundColor Cyan
foreach ($file in $filesToDelete) {
    Write-Host "  $($file.FullName)" -ForegroundColor White
}

if ($WhatIf) {
    Write-Host "`nWhatIf mode: No files will be deleted." -ForegroundColor Yellow
    exit 0
}

if (-not $Force) {
    $confirmation = Read-Host "`nDo you want to delete these files? (y/N)"
    if ($confirmation -ne 'y' -and $confirmation -ne 'yes') {
        Write-Host "Operation cancelled." -ForegroundColor Yellow
        exit 0
    }
}

# Delete the files
$deletedCount = 0
$errorCount = 0

foreach ($file in $filesToDelete) {
    try {
        Remove-Item -Path $file.FullName -Force
        Write-Host "Deleted: $($file.FullName)" -ForegroundColor Green
        $deletedCount++
    }
    catch {
        Write-Host "Error deleting $($file.FullName): $($_.Exception.Message)" -ForegroundColor Red
        $errorCount++
    }
}

Write-Host "`nOperation completed:" -ForegroundColor Cyan
Write-Host "  Files deleted: $deletedCount" -ForegroundColor Green
Write-Host "  Errors: $errorCount" -ForegroundColor $(if ($errorCount -gt 0) { "Red" } else { "Green" })

if ($errorCount -gt 0) {
    Write-Host "`nSome files could not be deleted. They may be in use or you may need to run as administrator." -ForegroundColor Yellow
}
