try {
    # 1) GET bootstrap (try direct file path or typical localhost port)
    $bootstrapResponse = Invoke-RestMethod -Uri "http://localhost:80/SCA.CORPOELEC/api/index.php/bootstrap" -Method Get
    $firstEmployee = $bootstrapResponse.data.empleados[0]
    
    if (-not $firstEmployee) {
        Write-Host "No employees found."
        return
    }

    $originalCargo = $firstEmployee.cargo
    $originalCedula = $firstEmployee.cedula
    $nombre = $firstEmployee.nombre
    $departamento = $firstEmployee.departamento

    # 2) POST update
    $body1 = @{ original_cedula=$originalCedula; nombre=$nombre; cedula=$originalCedula; departamento=$departamento; cargo="Analista Senior" }
    $req1 = Invoke-WebRequest -Uri "http://localhost:80/SCA.CORPOELEC/api/index.php/employee_update" -Method Post -Body ($body1 | ConvertTo-Json) -ContentType "application/json" -ErrorAction Stop
    $res1 = $req1.Content | ConvertFrom-Json
    Write-Host "Update 1: Status $($req1.StatusCode), ok: $($res1.ok)"

    # 3) POST revert
    $body2 = @{ original_cedula=$originalCedula; nombre=$nombre; cedula=$originalCedula; departamento=$departamento; cargo=$originalCargo }
    $req2 = Invoke-WebRequest -Uri "http://localhost:80/SCA.CORPOELEC/api/index.php/employee_update" -Method Post -Body ($body2 | ConvertTo-Json) -ContentType "application/json" -ErrorAction Stop
    $res2 = $req2.Content | ConvertFrom-Json
    Write-Host "Update 2: Status $($req2.StatusCode), ok: $($res2.ok)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
    if ($_.Exception.Response) { 
        $r = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); 
        Write-Host "Body: $($r.ReadToEnd())" 
    }
}
