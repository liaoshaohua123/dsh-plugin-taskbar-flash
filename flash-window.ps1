param(
  [Parameter(Mandatory = $true)][int]$HostPid,
  # Built-in identifier chosen on the Plugins page; unknown values fall back to
  # the default chime. `system` uses the Windows Asterisk alias, `none` stays
  # silent and only flashes.
  [string]$Sound = 'chime',
  # Absolute path of a user-supplied audio file. Only used when -Sound is
  # `custom`; the host validates the file before starting this script.
  [string]$SoundFile = '',
  # Play the chosen sound and exit without touching any window. Used by the
  # README verification command and by sound troubleshooting.
  [switch]$SoundOnly,
  [switch]$ProbeOnly,
  [switch]$Clear
)
$ErrorActionPreference = 'Stop'
try {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DshTaskbarFlash {
  [StructLayout(LayoutKind.Sequential)]
  public struct FLASHWINFO {
    public uint cbSize;
    public IntPtr hwnd;
    public uint dwFlags;
    public uint uCount;
    public uint dwTimeout;
  }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FLASHWINFO info);
  [DllImport("winmm.dll", EntryPoint = "PlaySoundW", CharSet = CharSet.Unicode)]
  public static extern bool PlaySound(string sound, IntPtr module, uint flags);
  // MCI handles the compressed formats PlaySound cannot: mp3, m4a, ogg, flac.
  [DllImport("winmm.dll", EntryPoint = "mciSendStringW", CharSet = CharSet.Unicode)]
  public static extern int MciSendString(string command, System.Text.StringBuilder ret, uint retLen, IntPtr hwnd);
}
'@
  function Get-NormalizedSoundKey([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return 'chime' }
    return $Value.Trim().ToLowerInvariant()
  }
  # NOTE: PowerShell variables are case-insensitive. Never name a local state
  # variable `$sound` here: that would shadow the `-Sound` parameter.
  function Invoke-ReminderSound([string]$Key, [string]$FilePath) {
    try {
      if ($Key -eq 'none') { return 'muted' }
      if ($Key -eq 'custom') {
        if ([string]::IsNullOrWhiteSpace($FilePath)) { throw 'No custom sound file was given.' }
        if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
          throw "Custom reminder sound is missing: $FilePath"
        }
        $extension = [IO.Path]::GetExtension($FilePath).ToLowerInvariant()
        if ($extension -eq '.wav') {
          # SND_FILENAME (0x20000) | SND_NODEFAULT (2), synchronous by default.
          if (-not [DshTaskbarFlash]::PlaySound($FilePath, [IntPtr]::Zero, 0x20002)) {
            throw 'Windows could not play the custom WAV file.'
          }
          return 'played'
        }
        # Otherwise let MCI pick the installed decoder. `wait` blocks until the
        # clip ends, so cap very long files instead of holding the helper open.
        $alias = 'dshremind' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
        $escaped = $FilePath.Replace('"', '""')
        $opened = [DshTaskbarFlash]::MciSendString("open `"$escaped`" alias $alias", $null, 0, [IntPtr]::Zero)
        if ($opened -ne 0) { throw "Cannot open the custom sound file (MCI $opened)." }
        try {
          $length = New-Object System.Text.StringBuilder 64
          $state = [DshTaskbarFlash]::MciSendString("status $alias length", $length, 64, [IntPtr]::Zero)
          [int]$milliseconds = 0
          if ($state -eq 0) { [void][int]::TryParse($length.ToString().Trim(), [ref]$milliseconds) }
          if ($milliseconds -gt 15000) {
            $played = [DshTaskbarFlash]::MciSendString("play $alias from 0", $null, 0, [IntPtr]::Zero)
            if ($played -ne 0) { throw "Cannot play the custom sound file (MCI $played)." }
            Start-Sleep -Milliseconds 15000
          } else {
            $played = [DshTaskbarFlash]::MciSendString("play $alias wait", $null, 0, [IntPtr]::Zero)
            if ($played -ne 0) { throw "Cannot play the custom sound file (MCI $played)." }
          }
        } finally {
          [void][DshTaskbarFlash]::MciSendString("close $alias", $null, 0, [IntPtr]::Zero)
        }
        return 'played'
      }
      if ($Key -eq 'system') {
        # SND_ALIAS (0x10000) | SND_NODEFAULT (2): the Windows scheme's Asterisk
        # sound, never the generic beep.
        if (-not [DshTaskbarFlash]::PlaySound('SystemAsterisk', [IntPtr]::Zero, 0x10002)) {
          throw 'Windows could not play the system reminder sound.'
        }
        return 'played'
      }
      $files = @{
        chime   = 'reminder.wav'
        bright  = 'sounds\bright.wav'
        soft    = 'sounds\soft.wav'
        triple  = 'sounds\triple.wav'
        deep    = 'sounds\deep.wav'
        velvet  = 'sounds\velvet.wav'
        ember   = 'sounds\ember.wav'
        resolve = 'sounds\resolve.wav'
      }
      if (-not $files.ContainsKey($Key)) { throw "Unknown reminder sound '$Key'." }
      $soundPath = Join-Path $PSScriptRoot $files[$Key]
      if (-not (Test-Path -LiteralPath $soundPath -PathType Leaf)) { throw "Reminder sound '$Key' is missing." }
      # SND_FILENAME (0x20000) | SND_NODEFAULT (2), synchronous by default.
      if (-not [DshTaskbarFlash]::PlaySound($soundPath, [IntPtr]::Zero, 0x20002)) {
        throw 'Windows could not play the reminder sound.'
      }
      return 'played'
    } catch {
      Write-Warning $_
      return 'failed'
    }
  }

  $soundKey = Get-NormalizedSoundKey $Sound
  $knownSounds = @('chime', 'bright', 'soft', 'triple', 'deep', 'velvet', 'ember', 'resolve', 'custom', 'system', 'none')
  if ($soundKey -notin $knownSounds) { $soundKey = 'chime' }

  if ($SoundOnly) {
    $soundState = Invoke-ReminderSound $soundKey $SoundFile
    [pscustomobject]@{ taskbarFlash = 'skipped'; sound = $soundState; soundKey = $soundKey } | ConvertTo-Json -Compress
    if ($soundState -eq 'failed') { exit 1 } else { exit 0 }
  }

  # Follow only the owning executable's ancestors. Never match browser titles,
  # other DSH installations, Explorer, or an unrelated foreground window.
  $owner = Get-Process -Id $HostPid
  $ownerPath = $owner.Path
  $candidate = $HostPid
  $windowHandle = [IntPtr]::Zero
  $windowPid = 0
  for ($depth = 0; $depth -lt 16 -and $candidate -gt 0; $depth++) {
    $ancestor = Get-Process -Id $candidate -ErrorAction SilentlyContinue
    if (-not $ancestor -or $ancestor.Path -ne $ownerPath) { break }
    if ($ancestor.MainWindowHandle -ne [IntPtr]::Zero) {
      $windowHandle = $ancestor.MainWindowHandle
      $windowPid = $candidate
      break
    }
    $record = Get-CimInstance Win32_Process -Filter "ProcessId = $candidate"
    if (-not $record -or $record.ParentProcessId -eq $candidate) { break }
    $candidate = [int]$record.ParentProcessId
  }
  $noWindow = $windowHandle -eq [IntPtr]::Zero -or -not [DshTaskbarFlash]::IsWindow($windowHandle)
  $foreground = $false
  $action = 'probe'
  $flags = 0
  if (-not $noWindow) {
    [uint32]$actualPid = 0
    [void][DshTaskbarFlash]::GetWindowThreadProcessId($windowHandle, [ref]$actualPid)
    if ($actualPid -ne $windowPid) { throw 'Window ownership changed before flash.' }
    $foreground = [DshTaskbarFlash]::GetForegroundWindow() -eq $windowHandle
    if (-not $ProbeOnly) {
      if ($foreground -and -not $Clear) {
        $action = 'already-foreground'
      } else {
        $info = New-Object DshTaskbarFlash+FLASHWINFO
        $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][DshTaskbarFlash+FLASHWINFO])
        $info.hwnd = $windowHandle
        # FLASHW_TRAY (2) | FLASHW_TIMERNOFG (12): stop automatically on focus.
        $info.dwFlags = $(if ($Clear) { 0 } else { 14 })
        $info.uCount = [uint32]::MaxValue
        $info.dwTimeout = 0
        # The return value is the previous activation state, not success/failure.
        [void][DshTaskbarFlash]::FlashWindowEx([ref]$info)
        $flags = $info.dwFlags
        $action = $(if ($Clear) { 'cleared' } else { 'requested' })
      }
    }
  }

  # Play after the flash request so long, low sounds never delay the visual
  # alert. Probe and clear operations stay silent.
  $soundState = 'skipped'
  if (-not $ProbeOnly -and -not $Clear) {
    $soundState = Invoke-ReminderSound $soundKey $SoundFile
  }

  if ($noWindow) {
    [pscustomobject]@{ taskbarFlash = 'no-desktop-window'; sound = $soundState; soundKey = $soundKey } | ConvertTo-Json -Compress
    exit 2
  }
  [pscustomobject]@{
    taskbarFlash = $action; windowPid = $windowPid;
    windowHandle = $windowHandle.ToInt64(); foreground = $foreground; flags = $flags; sound = $soundState; soundKey = $soundKey
  } | ConvertTo-Json -Compress
} catch {
  Write-Error $_
  exit 1
}
