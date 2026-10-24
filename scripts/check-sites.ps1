$ErrorActionPreference = 'Continue'
foreach ($h in @('https://www.beponline.life', 'https://beponline.life', 'https://transfer-9d294.web.app/')) {
  try {
    $r = Invoke-WebRequest -Uri $h -UseBasicParsing -TimeoutSec 25
    $t = [regex]::Match($r.Content, '<title>(.*?)</title>').Groups[1].Value
    $js = [regex]::Match($r.Content, 'src="([^"]+\.js)"').Groups[1].Value
    Write-Output ("{0} => {1} len={2} title='{3}' js='{4}'" -f $h, $r.StatusCode, $r.RawContentLength, $t, $js)
  }
  catch {
    Write-Output ("{0} => ERR {1}" -f $h, $_.Exception.Message)
  }
}
