# Painel do Corny: liga e desliga o servidor do jogo e o túnel público numa janela,
# sem precisar do start.bat/stop.bat (que continuam funcionando).
# Abra pelo painel.bat. Mesma lógica do start.bat: ngrok com endereço fixo
# (NGROK_DOMAIN/NGROK_AUTHTOKEN no .env) ou, sem ele, túnel temporário da Cloudflare.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Dir.EndsWith('\')) { $Dir += '\' }
$LogDir = Join-Path $Dir 'logs'
$ServerLog = Join-Path $LogDir 'server.log'
$UrlFile = Join-Path $Dir 'URL_PUBLICA.txt'
$LocalUrl = 'http://localhost:3000'

# ==================== LÓGICA ====================

function Read-DotEnv {
  $values = @{}
  $file = Join-Path $Dir '.env'
  if (Test-Path $file) {
    foreach ($line in Get-Content $file) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim() }
    }
  }
  return $values
}

# Processos deste jogo (mesma regra do stop.bat): o node do server.js desta pasta e o túnel
# que está dentro desta pasta ou tem a pasta na linha de comando (ngrok instalado no sistema)
function Get-CornyProcesses {
  Get-CimInstance Win32_Process | Where-Object {
    $tunnel = $_.Name -eq 'ngrok.exe' -or $_.Name -eq 'cloudflared.exe'
    ($_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.IndexOf($Dir + 'server.js', [StringComparison]::OrdinalIgnoreCase) -ge 0) -or
    ($tunnel -and (($_.ExecutablePath -and $_.ExecutablePath.StartsWith($Dir, [StringComparison]::OrdinalIgnoreCase)) -or
                   ($_.CommandLine -and $_.CommandLine.IndexOf($Dir, [StringComparison]::OrdinalIgnoreCase) -ge 0)))
  }
}

# ngrok instalado (winget install ngrok.ngrok ou Microsoft Store). Não baixamos o arquivo
# solto: o Windows Defender o bloqueia como software potencialmente indesejado.
function Find-Ngrok {
  $local = Join-Path $Dir 'tools\ngrok.exe'
  if (Test-Path $local) { return $local }
  $cmd = Get-Command ngrok -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) { return $cmd.Source }
  # Instalado agora há pouco o PATH desta janela ainda não sabe: procura nas pastas do winget e da Store
  $candidates = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\ngrok.exe"
    (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_*\ngrok.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName)
    "$env:LOCALAPPDATA\Microsoft\WindowsApps\ngrok.exe"
  )
  foreach ($path in $candidates) { if ($path -and (Test-Path $path)) { return $path } }
  return $null
}

function Get-CornyStatus {
  $procs = @(Get-CornyProcesses)
  [pscustomobject]@{
    Server = [bool]($procs | Where-Object Name -eq 'node.exe')
    Tunnel = [bool]($procs | Where-Object { $_.Name -ne 'node.exe' })
    Url    = if (Test-Path $UrlFile) { (Get-Content $UrlFile -TotalCount 1).Trim() } else { $null }
  }
}

# Roda um comando sem abrir janela de console e espera terminar, sem travar o painel
function Invoke-Hidden([string]$commandLine) {
  $psi = New-Object Diagnostics.ProcessStartInfo 'cmd.exe', "/c $commandLine"
  $psi.WorkingDirectory = $Dir
  $psi.CreateNoWindow = $true
  $psi.UseShellExecute = $false
  $p = [Diagnostics.Process]::Start($psi)
  while (-not $p.HasExited) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
  return $p.ExitCode
}

function Wait-Until([scriptblock]$condition, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $condition) { return $true }
    [Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 400
  }
  return $false
}

function Stop-Corny {
  Invoke-Hidden "`"$($Dir)stop.bat`" /silencioso" | Out-Null
}

function Start-Corny([scriptblock]$report) {
  & $report 'Parando o que já estava rodando...'
  Stop-Corny

  & $report 'Verificando dependências (npm install)...'
  New-Item -ItemType Directory -Force $LogDir | Out-Null
  Invoke-Hidden "npm install --no-audit --no-fund --loglevel=error > `"$LogDir\npm.log`" 2>&1" | Out-Null

  & $report 'Iniciando o servidor...'
  $psi = New-Object Diagnostics.ProcessStartInfo 'cmd.exe', "/c node --disable-warning=ExperimentalWarning `"$($Dir)server.js`" > `"$ServerLog`" 2>&1"
  $psi.WorkingDirectory = $Dir
  $psi.CreateNoWindow = $true
  $psi.UseShellExecute = $false
  [Diagnostics.Process]::Start($psi) | Out-Null
  $up = Wait-Until { try { (Invoke-WebRequest -UseBasicParsing -Uri $LocalUrl -TimeoutSec 2).StatusCode -eq 200 } catch { $false } } 20
  if (-not $up) { throw 'O servidor não respondeu. Veja o log abaixo.' }

  Start-Tunnel $report
}

function Start-Tunnel([scriptblock]$report) {
  Remove-Item (Join-Path $Dir 'tunnel.log'), $UrlFile -ErrorAction SilentlyContinue
  $envValues = Read-DotEnv
  $tools = Join-Path $Dir 'tools'
  New-Item -ItemType Directory -Force $tools | Out-Null

  if ($envValues['NGROK_DOMAIN']) {
    $ngrok = Find-Ngrok
    if (-not $ngrok) {
      & $report 'ngrok não instalado (winget install ngrok.ngrok). Usando a Cloudflare...'
      Start-Sleep -Seconds 2
    } else {
      & $report "Abrindo o endereço fixo $($envValues['NGROK_DOMAIN'])..."
      if ($envValues['NGROK_AUTHTOKEN']) { $env:NGROK_AUTHTOKEN = $envValues['NGROK_AUTHTOKEN'] }
      # Log próprio (ngrok.log) com caminho completo: guarda o motivo de uma falha e deixa a pasta
      # do jogo na linha de comando, que é como o stop.bat acha este ngrok
      $ngrokLog = Join-Path $Dir 'ngrok.log'
      Remove-Item $ngrokLog -ErrorAction SilentlyContinue
      Start-Process -FilePath $ngrok -ArgumentList 'http', '3000', "--domain=$($envValues['NGROK_DOMAIN'])", '--log', "`"$ngrokLog`"" -WorkingDirectory $Dir -WindowStyle Hidden
      $found = Wait-Until {
        try {
          $t = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2
          $u = $t.tunnels | Where-Object { $_.public_url -like "*$($envValues['NGROK_DOMAIN'])*" } | Select-Object -First 1
          if ($u) { Set-Content -Path $UrlFile -Value $u.public_url; $true } else { $false }
        } catch { $false }
      } 20
      if ($found) { return }
      Get-CornyProcesses | Where-Object Name -eq 'ngrok.exe' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
      $reason = if (Test-Path $ngrokLog) { Get-Content $ngrokLog | Where-Object { $_ -match 'lvl=(eror|crit)|err=' } | Select-Object -Last 1 } else { 'o ngrok nem chegou a iniciar' }
      [Windows.Forms.MessageBox]::Show("O ngrok não abriu o endereço fixo. Vou usar a Cloudflare.`n`nMotivo (ngrok.log):`n$reason", 'Corny', 'OK', 'Warning') | Out-Null
      & $report 'Usando a Cloudflare...'
    }
  }

  $cloudflared = Join-Path $tools 'cloudflared.exe'
  if (-not (Test-Path $cloudflared)) {
    & $report 'Baixando o cloudflared...'
    try { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cloudflared } catch { }
  }
  if (-not (Test-Path $cloudflared)) { throw 'Não foi possível baixar o túnel. O jogo funciona só na rede local.' }

  & $report 'Abrindo o túnel temporário da Cloudflare...'
  Start-Process -FilePath $cloudflared -ArgumentList 'tunnel', '--no-autoupdate', '--url', $LocalUrl, '--logfile', 'tunnel.log' -WorkingDirectory $Dir -WindowStyle Hidden
  $log = Join-Path $Dir 'tunnel.log'
  $found = Wait-Until {
    if ((Test-Path $log) -and ((Get-Content $log -Raw) -match 'https://[a-z0-9-]+\.trycloudflare\.com')) { Set-Content -Path $UrlFile -Value $Matches[0]; $true } else { $false }
  } 30
  if (-not $found) { throw 'O túnel não respondeu. Veja tunnel.log na pasta do jogo.' }
}

# Testes sem janela: CORNY_PAINEL_SEM_JANELA=1 só carrega as funções acima
if ($env:CORNY_PAINEL_SEM_JANELA) { return }

# ==================== JANELA ====================

[Windows.Forms.Application]::EnableVisualStyles()
$c = @{
  bg = [Drawing.Color]::FromArgb(31, 11, 71); panel = [Drawing.Color]::FromArgb(44, 18, 99)
  yellow = [Drawing.Color]::FromArgb(255, 225, 26); pink = [Drawing.Color]::FromArgb(224, 10, 116)
  purple = [Drawing.Color]::FromArgb(122, 45, 240); cyan = [Drawing.Color]::FromArgb(25, 227, 255)
  soft = [Drawing.Color]::FromArgb(203, 191, 247); green = [Drawing.Color]::FromArgb(70, 220, 120)
  ink = [Drawing.Color]::FromArgb(11, 3, 24)
}

$form = New-Object Windows.Forms.Form
$form.Text = 'Corny · Servidor'
$form.ClientSize = New-Object Drawing.Size(500, 470)
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.StartPosition = 'CenterScreen'
$form.BackColor = $c.bg
$form.ForeColor = [Drawing.Color]::White
$form.Font = New-Object Drawing.Font('Segoe UI', 10)

function New-Label($text, $x, $y, $w, $h, $font, $color) {
  $l = New-Object Windows.Forms.Label
  $l.Text = $text; $l.Location = New-Object Drawing.Point($x, $y); $l.Size = New-Object Drawing.Size($w, $h)
  if ($font) { $l.Font = $font }
  if ($color) { $l.ForeColor = $color }
  $form.Controls.Add($l); return $l
}

function New-Button($text, $x, $y, $w, $back, $fore) {
  $b = New-Object Windows.Forms.Button
  $b.Text = $text; $b.Location = New-Object Drawing.Point($x, $y); $b.Size = New-Object Drawing.Size($w, 40)
  $b.FlatStyle = 'Flat'; $b.FlatAppearance.BorderColor = $c.ink; $b.FlatAppearance.BorderSize = 2
  $b.BackColor = $back; $b.ForeColor = $fore
  $b.Font = New-Object Drawing.Font('Segoe UI', 10, [Drawing.FontStyle]::Bold)
  $b.Cursor = 'Hand'
  $form.Controls.Add($b); return $b
}

New-Label 'CORNY' 20 14 200 40 (New-Object Drawing.Font('Segoe UI Black', 22)) $c.yellow | Out-Null
New-Label 'Painel do servidor' 22 54 300 22 $null $c.cyan | Out-Null

$dot = New-Label '●' 20 92 26 30 (New-Object Drawing.Font('Segoe UI', 16)) $c.soft
$statusLabel = New-Label 'Verificando...' 48 96 430 26 (New-Object Drawing.Font('Segoe UI', 11, [Drawing.FontStyle]::Bold)) $null

$btnStart = New-Button 'Iniciar' 20 132 140 $c.pink ([Drawing.Color]::White)
$btnStop = New-Button 'Parar' 176 132 140 $c.purple ([Drawing.Color]::White)
$btnRestart = New-Button 'Reiniciar' 332 132 148 $c.panel ([Drawing.Color]::White)

New-Label 'Link público' 20 186 200 20 (New-Object Drawing.Font('Segoe UI', 9, [Drawing.FontStyle]::Bold)) $c.yellow | Out-Null
$urlLink = New-Object Windows.Forms.LinkLabel
$urlLink.Location = New-Object Drawing.Point(20, 206); $urlLink.Size = New-Object Drawing.Size(460, 24)
$urlLink.LinkColor = $c.cyan; $urlLink.ActiveLinkColor = $c.yellow; $urlLink.Text = '—'
$form.Controls.Add($urlLink)

$btnCopy = New-Button 'Copiar link' 20 236 140 $c.yellow $c.ink
$btnOpen = New-Button 'Abrir jogo' 176 236 140 $c.cyan $c.ink
$btnFolder = New-Button 'Abrir pasta' 332 236 148 $c.panel ([Drawing.Color]::White)

New-Label 'Log do servidor' 20 290 200 20 (New-Object Drawing.Font('Segoe UI', 9, [Drawing.FontStyle]::Bold)) $c.yellow | Out-Null
$logBox = New-Object Windows.Forms.TextBox
$logBox.Multiline = $true; $logBox.ReadOnly = $true; $logBox.ScrollBars = 'Vertical'
$logBox.Location = New-Object Drawing.Point(20, 312); $logBox.Size = New-Object Drawing.Size(460, 140)
$logBox.BackColor = $c.ink; $logBox.ForeColor = $c.soft; $logBox.BorderStyle = 'FixedSingle'
$logBox.Font = New-Object Drawing.Font('Consolas', 9)
$form.Controls.Add($logBox)

$script:busy = $false
$script:lastLog = ''

function Set-Status($text, $color) {
  $statusLabel.Text = $text
  $dot.ForeColor = $color
  [Windows.Forms.Application]::DoEvents()
}

function Update-View {
  if ($script:busy) { return }
  $s = Get-CornyStatus
  if ($s.Server) {
    Set-Status ($(if ($s.Tunnel) { 'Rodando (com link público)' } else { 'Rodando (só na rede local)' })) $c.green
  } else {
    Set-Status 'Parado' $c.pink
  }
  $btnStart.Enabled = -not $s.Server
  $btnStop.Enabled = $s.Server -or $s.Tunnel
  $btnRestart.Enabled = $s.Server
  $urlLink.Text = if ($s.Server -and $s.Url) { $s.Url } else { '—' }
  $btnCopy.Enabled = $btnOpen.Enabled = $s.Server

  if (Test-Path $ServerLog) {
    $text = (Get-Content $ServerLog -Tail 40 -Encoding UTF8 -ErrorAction SilentlyContinue) -join "`r`n"
    if ($text -ne $script:lastLog) {
      $script:lastLog = $text
      $logBox.Text = $text
      $logBox.SelectionStart = $logBox.Text.Length
      $logBox.ScrollToCaret()
    }
  }
}

function Invoke-Busy([scriptblock]$action) {
  $script:busy = $true
  foreach ($b in $btnStart, $btnStop, $btnRestart) { $b.Enabled = $false }
  try {
    & $action
  } catch {
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Corny', 'OK', 'Warning') | Out-Null
  } finally {
    $script:busy = $false
    Update-View
  }
}

$report = { param($msg) Set-Status $msg $c.yellow }

$btnStart.Add_Click({ Invoke-Busy { Start-Corny $report } })
$btnStop.Add_Click({ Invoke-Busy { & $report 'Parando...'; Stop-Corny } })
$btnRestart.Add_Click({ Invoke-Busy { Start-Corny $report } })
$btnCopy.Add_Click({
  $url = if ($urlLink.Text -ne '—') { $urlLink.Text } else { $LocalUrl }
  [Windows.Forms.Clipboard]::SetText($url)
  $btnCopy.Text = 'Copiado!'
})
$btnOpen.Add_Click({ Start-Process $LocalUrl })
$btnFolder.Add_Click({ Start-Process 'explorer.exe' $Dir })
$urlLink.Add_LinkClicked({ if ($urlLink.Text -ne '—') { Start-Process $urlLink.Text } })

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 2500
$timer.Add_Tick({ if ($btnCopy.Text -ne 'Copiar link') { $btnCopy.Text = 'Copiar link' }; Update-View })

$form.Add_Shown({ Update-View; $timer.Start() })
$form.Add_FormClosing({
  param($sender, $e)
  if ($script:busy) { $e.Cancel = $true; return }
  $s = Get-CornyStatus
  if ($s.Server -or $s.Tunnel) {
    $answer = [Windows.Forms.MessageBox]::Show("O servidor está rodando.`n`nParar o servidor também?`n(Não = continua rodando em segundo plano)", 'Corny', 'YesNoCancel', 'Question')
    if ($answer -eq 'Cancel') { $e.Cancel = $true; return }
    if ($answer -eq 'Yes') { Stop-Corny }
  }
  $timer.Stop()
})

[Windows.Forms.Application]::Run($form)
