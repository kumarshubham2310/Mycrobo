Write-Host "Downloading Go 1.26.9..."
curl.exe -L "https://dl.google.com/go/go1.26.9.windows-amd64.zip" -o "C:\Users\shubh\.tools\go.zip"
Write-Host "Extracting Go..."
Expand-Archive -Path "C:\Users\shubh\.tools\go.zip" -DestinationPath "C:\Users\shubh\.tools" -Force
Remove-Item "C:\Users\shubh\.tools\go.zip" -Force

Write-Host "Downloading Node.js v22.23.3..."
curl.exe -L "https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip" -o "C:\Users\shubh\.tools\node.zip"
Write-Host "Extracting Node.js..."
Expand-Archive -Path "C:\Users\shubh\.tools\node.zip" -DestinationPath "C:\Users\shubh\.tools" -Force
Remove-Item "C:\Users\shubh\.tools\node.zip" -Force

Write-Host "Configuring User PATH..."
$goBin = "C:\Users\shubh\.tools\go\bin"
$nodeBin = "C:\Users\shubh\.tools\node-v22.23.3-win-x64"

$currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$parts = ($currentUserPath -split ";") | Where-Object { $_ -ne "" }
$newParts = @($nodeBin, $goBin) + ($parts | Where-Object { $_ -ne $nodeBin -and $_ -ne $goBin })
$updatedPath = $newParts -join ";"
[Environment]::SetEnvironmentVariable("Path", $updatedPath, "User")

Write-Host "Setup completed successfully!"
