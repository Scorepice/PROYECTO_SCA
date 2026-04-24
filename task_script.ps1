try {
    # 1) GET bootstrap
    $bootstrapResponse = Invoke-RestMethod -Uri "http://localhost/SCA.CORPOELEC/api/index.php/bootstrap" -Method Get
    $firstEmployee = $bootstrapResponse.data.empleados[0]
    
    if (-not $firstEmployee) {
        Write-Host "No employees found in bootstrap data."
        return
    }

    $originalCargo = $firstEmployee.cargo
    $originalCedula = $firstEmployee.cedula
    $nombre = $firstEmployee.nombre
    $departamento = $firstEmployee.departamento

    # 2) POST employee_update to 'Analista Senior'
    $updateBody = @{
        original_cedula = $originalCedula
        nombre = $nombre
        cedula = $originalCedula
        departamento = $departamento
        cargo = "Analista Senior"
    }
    
    $response1 = Invoke-WebRequest -Uri "http://localhost/SCA.CORPOELEC/api/index.php/employee_update" -Method Post -Body ($updateBody | ConvertTo-Json) -ContentType "application/json" -ErrorAction Stop
    $json1 = $response1.Content | ConvertFrom-Json
    Write-Host "Update 1 (Analista Senior): Status: $($response1.StatusCode), ok: $($json1.ok)"
    if ($json1.ok -ne $true) { Write-Host $response1.Content }

    # 3) POST employee_update to revert
    $revertBody = @{
        original_cedula = $originalCedula
        nombre = $nombre
        cedula = $originalCedula
        departamento = $departamento
        cargo = $originalCargo
    }
    
    $response2 = Invoke-WebRequest -Uri "http://localhost/SCA.CORPOELEC/api/index.php/employee_update" -Method Post -Body ($revertBody | ConvertTo-Json) -ContentType "application/json" -ErrorAction Stop
    $json2 = $response2.Content | ConvertFrom-Json
    Write-Host "Update 2 (Revert): Status: $($response2.StatusCode), ok: $($json2.ok)"
    if ($json2.ok -ne $true) { Write-Host $response2.Content }

} catch {
    Write-Host "Error occurred:"
    if ($null -ne $_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()
        Write-Host "HTTP Status: $($_.Exception.Response.StatusCode)"
        Write-Host "Response Body: $body"
    } else {
        Write-Host $_.Exception.Message
    }
}
