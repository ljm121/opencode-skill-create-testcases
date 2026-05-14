param(
    [Parameter(Mandatory = $false)]
    [string]$InputJson,

    [Parameter(Mandatory = $false)]
    [string]$InputJsonText,

    [Parameter(Mandatory = $false)]
    [string]$InputPath,

    [Parameter(Mandatory = $false)]
    [string]$InputUrl,

    [Parameter(Mandatory = $false)]
    [string]$OutputDir,

    [Parameter(Mandatory = $false)]
    [string]$Prefix,

    [Parameter(Mandatory = $false)]
    [string]$XmindTemplate,

    [Parameter(Mandatory = $false)]
    [switch]$SplitByModule,

    [Parameter(Mandatory = $false)]
    [switch]$Preview
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$hasUrl = -not [string]::IsNullOrWhiteSpace($InputUrl)

$providedInputs = @(@(
    -not [string]::IsNullOrWhiteSpace($InputJson),
    -not [string]::IsNullOrWhiteSpace($InputJsonText),
    -not [string]::IsNullOrWhiteSpace($InputPath)
) | Where-Object { $_ })

# Mode A: URL alone → print agent guidance and exit
if ($hasUrl -and $providedInputs.Count -eq 0) {
    Write-Host @"

[export-testcases] -InputUrl detected without test case data.
Agent bridging workflow:
  1. Use webfetch/websearch to retrieve content from URL: $InputUrl
  2. Parse the content into structured test case JSON (see SKILL.md for schema)
  3. Re-invoke this script with -InputUrl AND -InputJsonText:
     powershell ...\export-testcases.ps1 -InputUrl "$InputUrl" -InputJsonText '<json>' -OutputDir <dir>
If you need the JSON schema, run with -InputUrl alone and check this message.
"@
    exit 0
}

# Validate URL combinations
if ($hasUrl -and $providedInputs.Count -gt 0) {
    if (-not [string]::IsNullOrWhiteSpace($InputJson) -or -not [string]::IsNullOrWhiteSpace($InputPath)) {
        throw "-InputUrl can only be paired with -InputJsonText, not with -InputJson or -InputPath."
    }
    if ([string]::IsNullOrWhiteSpace($InputJsonText)) {
        throw "-InputUrl requires -InputJsonText to provide structured test case data (or use -InputUrl alone for guidance)."
    }
}
elseif ($hasUrl) {
    # Already handled above (Mode A) - but keep as fallback
}

if ($providedInputs.Count -eq 0) {
    throw 'Either -InputJson, -InputJsonText, or -InputPath is required. Use -InputUrl <url> alone for guidance.'
}

if ($providedInputs.Count -gt 1) {
    throw '-InputJson, -InputJsonText, and -InputPath cannot be used together.'
}

function Get-SafeFileName {
    param([string]$Name)

    if ([string]::IsNullOrWhiteSpace($Name)) {
        return 'requirement'
    }

    $invalidChars = [System.IO.Path]::GetInvalidFileNameChars()
    $safe = $Name
    foreach ($char in $invalidChars) {
        $safe = $safe.Replace([string]$char, '_')
    }

    $safe = $safe.Trim()
    if ([string]::IsNullOrWhiteSpace($safe)) {
        return 'requirement'
    }

    return $safe
}

function Ensure-Directory {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        [void](New-Item -ItemType Directory -Path $Path -Force)
    }
}

function Remove-FileIfExists {
    param([string]$Path)

    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Force
    }
}

function Get-DefaultXmindTemplate {
    $skillRoot = Split-Path -Parent $PSScriptRoot
    $bundledTemplate = Join-Path $skillRoot 'templates\default-template.xmind'
    if (Test-Path -LiteralPath $bundledTemplate) {
        return $bundledTemplate
    }

    return $null
}

function Get-AbsolutePath {
    param([string]$Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Path))
}

function Get-ModuleDirectoryName {
    param([AllowNull()][string]$ModuleName)

    if ([string]::IsNullOrWhiteSpace($ModuleName)) {
        return '未分类模块'
    }

    return Get-SafeFileName -Name $ModuleName
}

function Get-InputExtension {
    param([string]$Path)

    $extension = [System.IO.Path]::GetExtension($Path)
    if ($null -eq $extension) {
        return ''
    }

    return $extension.ToLowerInvariant()
}

function Test-SupportedInputExtension {
    param([string]$Extension)

    $supportedExtensions = '.md', '.txt', '.html', '.htm', '.pdf', '.docx', '.doc'

    return ($supportedExtensions -contains $Extension)
}

function ConvertTo-NormalizedWhitespace {
    param([AllowNull()][string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ''
    }

    $normalized = $Text -replace "`r`n", "`n"
    $normalized = $normalized -replace "`r", "`n"
    $normalized = $normalized -replace "[\t\f\v]+", ' '
    $normalized = $normalized -replace '[ ]{2,}', ' '
    $normalized = $normalized -replace "\n{3,}", "`n`n"
    return $normalized.Trim()
}

function Convert-HtmlToPlainText {
    param([string]$Html)

    if ([string]::IsNullOrWhiteSpace($Html)) {
        return ''
    }

    $text = $Html
    $text = [System.Text.RegularExpressions.Regex]::Replace($text, '<script\b[^>]*>.*?</script>', '', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [System.Text.RegularExpressions.RegexOptions]::Singleline)
    $text = [System.Text.RegularExpressions.Regex]::Replace($text, '<style\b[^>]*>.*?</style>', '', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [System.Text.RegularExpressions.RegexOptions]::Singleline)
    $text = [System.Text.RegularExpressions.Regex]::Replace($text, '<br\s*/?>', "`n", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $text = [System.Text.RegularExpressions.Regex]::Replace($text, '</(p|div|li|tr|h1|h2|h3|h4|h5|h6|section|article|table)>', "`n", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $text = [System.Text.RegularExpressions.Regex]::Replace($text, '<[^>]+>', ' ')
    $text = [System.Net.WebUtility]::HtmlDecode($text)
    return ConvertTo-NormalizedWhitespace -Text $text
}

function Convert-MarkdownToPlainText {
    param([string]$Markdown)

    if ([string]::IsNullOrWhiteSpace($Markdown)) {
        return ''
    }

    $text = $Markdown
    $text = $text -replace '^#{1,6}\s*', ''
    $text = $text -replace '(?m)^\s*[-*+]\s+', ''
    $text = $text -replace '(?m)^\s*\d+\.\s+', ''
    $text = $text -replace '(?s)```.+?```', ' '
    $text = $text -replace '`([^`]+)`', '$1'
    $text = $text -replace '!\[[^\]]*\]\([^\)]*\)', ' '
    $text = $text -replace '\[([^\]]+)\]\([^\)]*\)', '$1'
    $text = $text -replace '[*_>~|]', ' '
    return ConvertTo-NormalizedWhitespace -Text $text
}

function Get-DocxText {
    param([string]$Path)

    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $entry = $zip.GetEntry('word/document.xml')
        if ($null -eq $entry) {
            foreach ($candidate in $zip.Entries) {
                $normalizedEntryName = $candidate.FullName.Replace('\', '/')
                if ($normalizedEntryName -eq 'word/document.xml') {
                    $entry = $candidate
                    break
                }
            }
        }
        if ($null -eq $entry) {
            throw "DOCX missing word/document.xml: $Path"
        }

        $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
        try {
            $xml = $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $zip.Dispose()
    }

    $xml = $xml -replace '</w:p>', "</w:p>`n"
    $matches = [System.Text.RegularExpressions.Regex]::Matches($xml, '<w:t[^>]*>(.*?)</w:t>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($match in $matches) {
        $parts.Add([System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value))
    }

    return ConvertTo-NormalizedWhitespace -Text (($parts.ToArray() -join ' '))
}

function Get-WordDocumentText {
    param([string]$Path)

    $word = $null
    $document = $null
    try {
        $word = New-Object -ComObject Word.Application
        $word.Visible = $false
        $word.DisplayAlerts = 0
        $document = $word.Documents.Open($Path, $false, $true)
        return ConvertTo-NormalizedWhitespace -Text ([string]$document.Content.Text)
    }
    catch {
        throw "Failed to parse Office-backed file '$Path'. Ensure Microsoft Word is installed. $($_.Exception.Message)"
    }
    finally {
        if ($document -ne $null) {
            try {
                $document.Close($false)
            }
            catch {
            }
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($document)
        }

        if ($word -ne $null) {
            try {
                $word.Quit()
            }
            catch {
            }
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
        }

        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
}

function Get-PlainTextFromFile {
    param([string]$Path)

    $extension = Get-InputExtension -Path $Path
    switch ($extension) {
        '.txt' {
            return ConvertTo-NormalizedWhitespace -Text (Get-Content -LiteralPath $Path -Raw -Encoding UTF8)
        }
        '.md' {
            return Convert-MarkdownToPlainText -Markdown (Get-Content -LiteralPath $Path -Raw -Encoding UTF8)
        }
        '.html' {
            return Convert-HtmlToPlainText -Html (Get-Content -LiteralPath $Path -Raw -Encoding UTF8)
        }
        '.htm' {
            return Convert-HtmlToPlainText -Html (Get-Content -LiteralPath $Path -Raw -Encoding UTF8)
        }
        '.docx' {
            return Get-DocxText -Path $Path
        }
        '.doc' {
            return Get-WordDocumentText -Path $Path
        }
        '.pdf' {
            return Get-WordDocumentText -Path $Path
        }
        default {
            throw "unsupported input file type: $extension"
        }
    }
}

function Test-LikelyHeadingText {
    param([AllowNull()][string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $false
    }

    $value = $Text.Trim()
    if ($value.Length -gt 24) {
        return $false
    }

    if ($value -match '[。！？；：:,.]') {
        return $false
    }

    return $true
}

function Get-HeadingLevelFromWordStyle {
    param([AllowNull()][string]$StyleValue)

    if ([string]::IsNullOrWhiteSpace($StyleValue)) {
        return 0
    }

    if ($StyleValue -match '(?i)heading[ ]*([1-6])') {
        return [int]$Matches[1]
    }

    return 0
}

function Get-WordXmlInnerText {
    param([AllowNull()][string]$Xml)

    if ([string]::IsNullOrWhiteSpace($Xml)) {
        return ''
    }

    $matches = [System.Text.RegularExpressions.Regex]::Matches($Xml, '<w:t[^>]*>(.*?)</w:t>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($match in $matches) {
        $parts.Add([System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value))
    }

    return ConvertTo-NormalizedWhitespace -Text (($parts.ToArray() -join ' '))
}

function Get-DocxStructuredContent {
    param([string]$Path)

    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $entry = $zip.GetEntry('word/document.xml')
        if ($null -eq $entry) {
            foreach ($candidate in $zip.Entries) {
                $normalizedEntryName = $candidate.FullName.Replace('\', '/')
                if ($normalizedEntryName -eq 'word/document.xml') {
                    $entry = $candidate
                    break
                }
            }
        }
        if ($null -eq $entry) {
            throw "DOCX missing word/document.xml: $Path"
        }

        $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
        try {
            $xml = $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $zip.Dispose()
    }

    $items = New-Object System.Collections.Generic.List[object]
    $tokenPattern = '<w:tbl\b[^>]*>.*?</w:tbl>|<w:p\b[^>]*>.*?</w:p>'
    $tokens = [System.Text.RegularExpressions.Regex]::Matches($xml, $tokenPattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
    foreach ($token in $tokens) {
        $value = $token.Value
        if ($value.StartsWith('<w:tbl')) {
            $rows = [System.Text.RegularExpressions.Regex]::Matches($value, '<w:tr\b[^>]*>.*?</w:tr>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
            foreach ($row in $rows) {
                $cells = [System.Text.RegularExpressions.Regex]::Matches($row.Value, '<w:tc\b[^>]*>.*?</w:tc>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
                $cellTexts = New-Object System.Collections.Generic.List[string]
                foreach ($cell in $cells) {
                    $cellText = Get-WordXmlInnerText -Xml $cell.Value
                    if (-not [string]::IsNullOrWhiteSpace($cellText)) {
                        $cellTexts.Add($cellText)
                    }
                }

                if ($cellTexts.Count -gt 0) {
                    $items.Add([pscustomobject]@{ Type = 'tableRow'; Level = 0; Text = ($cellTexts.ToArray() -join ' | ') })
                }
            }
            continue
        }

        $text = Get-WordXmlInnerText -Xml $value
        if ([string]::IsNullOrWhiteSpace($text)) {
            continue
        }

        $styleMatch = [System.Text.RegularExpressions.Regex]::Match($value, 'w:pStyle[^>]*w:val="([^"]+)"', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        $headingLevel = if ($styleMatch.Success) { Get-HeadingLevelFromWordStyle -StyleValue $styleMatch.Groups[1].Value } else { 0 }
        if ($headingLevel -gt 0) {
            $items.Add([pscustomobject]@{ Type = 'heading'; Level = $headingLevel; Text = $text })
            continue
        }

        if ($value -match '<w:numPr\b') {
            $items.Add([pscustomobject]@{ Type = 'listItem'; Level = 0; Text = $text })
            continue
        }

        $items.Add([pscustomobject]@{ Type = 'paragraph'; Level = 0; Text = $text })
    }

    return @($items.ToArray())
}

function Get-MarkdownStructuredContent {
    param([string]$Path)

    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($line in ($content -replace "`r`n", "`n" -replace "`r", "`n") -split "`n") {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) {
            continue
        }

        $headingMatch = [System.Text.RegularExpressions.Regex]::Match($trimmed, '^(#{1,6})\s+(.+)$')
        if ($headingMatch.Success) {
            $items.Add([pscustomobject]@{ Type = 'heading'; Level = $headingMatch.Groups[1].Value.Length; Text = (ConvertTo-NormalizedWhitespace -Text $headingMatch.Groups[2].Value) })
            continue
        }

        $listMatch = [System.Text.RegularExpressions.Regex]::Match($trimmed, '^([-*+]\s+|\d+\.\s+)(.+)$')
        if ($listMatch.Success) {
            $items.Add([pscustomobject]@{ Type = 'listItem'; Level = 0; Text = (ConvertTo-NormalizedWhitespace -Text $listMatch.Groups[2].Value) })
            continue
        }

        $items.Add([pscustomobject]@{ Type = 'paragraph'; Level = 0; Text = (ConvertTo-NormalizedWhitespace -Text $trimmed) })
    }

    return @($items.ToArray())
}

function Get-HtmlStructuredContent {
    param([string]$Path)

    $html = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $pattern = '<h([1-6])\b[^>]*>.*?</h\1>|<li\b[^>]*>.*?</li>|<p\b[^>]*>.*?</p>|<tr\b[^>]*>.*?</tr>'
    $tokens = [System.Text.RegularExpressions.Regex]::Matches($html, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [System.Text.RegularExpressions.RegexOptions]::Singleline)
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($token in $tokens) {
        $value = $token.Value
        $text = Convert-HtmlToPlainText -Html $value
        if ([string]::IsNullOrWhiteSpace($text)) {
            continue
        }

        if ($value -match '^<h([1-6])\b') {
            $items.Add([pscustomobject]@{ Type = 'heading'; Level = [int]$Matches[1]; Text = $text })
            continue
        }

        if ($value -match '^<li\b') {
            $items.Add([pscustomobject]@{ Type = 'listItem'; Level = 0; Text = $text })
            continue
        }

        if ($value -match '^<tr\b') {
            $items.Add([pscustomobject]@{ Type = 'tableRow'; Level = 0; Text = $text })
            continue
        }

        $items.Add([pscustomobject]@{ Type = 'paragraph'; Level = 0; Text = $text })
    }

    return @($items.ToArray())
}

function Get-TextStructuredContent {
    param([string]$Path)

    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $normalized = $content -replace "`r`n", "`n" -replace "`r", "`n"
    $lines = $normalized -split "`n"
    $items = New-Object System.Collections.Generic.List[object]
    $meaningfulLines = @($lines | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($meaningfulLines.Count -eq 0) {
        return @()
    }

    $firstHeadingUsed = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $trimmed = $lines[$i].Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) {
            continue
        }

        if (-not $firstHeadingUsed) {
            $items.Add([pscustomobject]@{ Type = 'heading'; Level = 1; Text = (ConvertTo-NormalizedWhitespace -Text $trimmed) })
            $firstHeadingUsed = $true
            continue
        }

        $listMatch = [System.Text.RegularExpressions.Regex]::Match($trimmed, '^([-*+]\s+|\d+\.\s+)(.+)$')
        if ($listMatch.Success) {
            $items.Add([pscustomobject]@{ Type = 'listItem'; Level = 0; Text = (ConvertTo-NormalizedWhitespace -Text $listMatch.Groups[2].Value) })
            continue
        }

        $nextMeaningful = $null
        for ($j = $i + 1; $j -lt $lines.Count; $j++) {
            $candidate = $lines[$j].Trim()
            if (-not [string]::IsNullOrWhiteSpace($candidate)) {
                $nextMeaningful = $candidate
                break
            }
        }

        if ((Test-LikelyHeadingText -Text $trimmed) -and $null -ne $nextMeaningful) {
            $items.Add([pscustomobject]@{ Type = 'heading'; Level = 2; Text = (ConvertTo-NormalizedWhitespace -Text $trimmed) })
            continue
        }

        $items.Add([pscustomobject]@{ Type = 'paragraph'; Level = 0; Text = (ConvertTo-NormalizedWhitespace -Text $trimmed) })
    }

    return @($items.ToArray())
}

function Get-StructuredContentFromFile {
    param([string]$Path)

    $extension = Get-InputExtension -Path $Path
    switch ($extension) {
        '.md' {
            return Get-MarkdownStructuredContent -Path $Path
        }
        '.txt' {
            return Get-TextStructuredContent -Path $Path
        }
        '.html' {
            return Get-HtmlStructuredContent -Path $Path
        }
        '.htm' {
            return Get-HtmlStructuredContent -Path $Path
        }
        '.docx' {
            return Get-DocxStructuredContent -Path $Path
        }
        default {
            return @()
        }
    }
}

function Get-ScenarioNameFromStructuredText {
    param(
        [AllowNull()][string]$HeadingText,
        [string]$RequirementText
    )

    if (-not [string]::IsNullOrWhiteSpace($HeadingText)) {
        return $HeadingText.Trim()
    }

    if ($RequirementText -match '必填|不能为空|校验|验证|格式|唯一匹配|规则') {
        return '规则验证'
    }
    if ($RequirementText -match '点击|提交|保存|发送|导出|查询|筛选|分摊|统计') {
        return '流程验证'
    }
    if ($RequirementText -match '展示|显示|查看|结果|状态|提示') {
        return '展示验证'
    }
    if ($RequirementText -match '调差|暂不处理') {
        return '范围验证'
    }

    return '功能验证'
}

function Get-PriorityFromRequirementText {
    param([string]$RequirementText)

    if ($RequirementText -match '必须|必填|不能为空|不得|不能|失败|错误|校验') {
        return 'P1'
    }

    return 'P2'
}

function New-TestCaseFromStructuredRequirement {
    param(
        [string]$Id,
        [string]$ModuleName,
        [string]$ScenarioName,
        [string]$RequirementText
    )

    $normalizedRequirement = ($RequirementText -replace '\s+', ' ').Trim().TrimEnd('。', '；', ';')
    $scenario = Get-ScenarioNameFromStructuredText -HeadingText $ScenarioName -RequirementText $normalizedRequirement
    $priority = Get-PriorityFromRequirementText -RequirementText $normalizedRequirement
    $expectedPrefix = if ($normalizedRequirement -match '暂不处理|不支持') { '系统保持当前范围约束：' } else { '系统行为符合要求：' }

    return [pscustomobject][ordered]@{
        id = $Id
        module = $ModuleName
        scenario = $scenario
        title = $normalizedRequirement
        preconditions = "已进入${ModuleName}相关业务场景。"
        steps = @(
            "进入${ModuleName}对应功能场景。",
            "按需求执行：$normalizedRequirement",
            '核对页面提示、状态变化或数据结果。'
        )
        expectedResult = "$expectedPrefix$normalizedRequirement"
        priority = $priority
        testType = '功能'
        notes = 'Generated from structured InputPath parsing.'
    }
}

function Convert-StructuredItemsToModules {
    param(
        [object[]]$Items,
        [string]$FallbackModuleName
    )

    $modules = New-Object System.Collections.Generic.List[object]
    $currentModule = $FallbackModuleName
    $currentScenario = ''
    $moduleRequirements = @{}
    $primaryHeadingSeen = $false

    foreach ($item in $Items) {
        $text = [string]$item.Text
        if ([string]::IsNullOrWhiteSpace($text)) {
            continue
        }

        if ($item.Type -eq 'heading') {
            if ($item.Level -le 1) {
                $currentModule = $text
                $currentScenario = ''
                $primaryHeadingSeen = $true
                continue
            }

            $currentScenario = $text
            continue
        }

        if (-not $moduleRequirements.ContainsKey($currentModule)) {
            $moduleRequirements[$currentModule] = New-Object System.Collections.Generic.List[object]
        }

        $moduleRequirements[$currentModule].Add([pscustomobject]@{
            Scenario = $currentScenario
            Text = $text
        })
    }

    if (-not $primaryHeadingSeen -and -not $moduleRequirements.ContainsKey($FallbackModuleName)) {
        $moduleRequirements[$FallbackModuleName] = New-Object System.Collections.Generic.List[object]
    }

    foreach ($moduleName in $moduleRequirements.Keys) {
        $requirements = @($moduleRequirements[$moduleName].ToArray() | Where-Object { -not [string]::IsNullOrWhiteSpace($_.Text) })
        if ($requirements.Count -eq 0) {
            continue
        }

        $modules.Add([pscustomobject]@{
            ModuleName = $moduleName
            Requirements = $requirements
        })
    }

    return @($modules.ToArray())
}

function Get-MeaningfulLines {
    param([string]$Text)

    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($line in (ConvertTo-NormalizedWhitespace -Text $Text) -split "`n") {
        $trimmed = ($line -replace '^[-*#\d\.\s]+', '').Trim()
        if ($trimmed.Length -ge 4) {
            $lines.Add($trimmed)
        }
    }

    return @($lines.ToArray())
}

function Get-ShortText {
    param(
        [AllowNull()][string]$Text,
        [int]$MaxLength = 40
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ''
    }

    $value = ($Text -replace '\s+', ' ').Trim()
    if ($value.Length -le $MaxLength) {
        return $value
    }

    return $value.Substring(0, $MaxLength).TrimEnd() + '...'
}

function Get-ScenarioNameFromRequirement {
    param([string]$Line)

    if ($Line -match 'required|empty|format|validate|invalid|必填|不能为空|格式|校验|验证') {
        return 'Validation'
    }
    if ($Line -match 'click|submit|save|send|view|export|action|flow|点击|提交|保存|发送|查看|导出|操作|流程') {
        return 'Flow'
    }
    if ($Line -match 'status|success|failed|prompt|display|show|状态|成功|失败|提示|展示|显示') {
        return 'Display'
    }

    return 'Rule'
}

function New-TestCaseFromRequirement {
    param(
        [string]$Id,
        [string]$ModuleName,
        [string]$RequirementLine
    )

    $short = Get-ShortText -Text $RequirementLine -MaxLength 36
    $scenario = Get-ScenarioNameFromRequirement -Line $RequirementLine
    return [pscustomobject][ordered]@{
        id = $Id
        module = $ModuleName
        scenario = $scenario
        title = "$ModuleName requirement coverage: $short"
        preconditions = "$ModuleName is accessible."
        steps = @(
            "Open or locate the $ModuleName feature, page, or requirement source.",
            "Verify requirement detail: $RequirementLine"
        )
        expectedResult = "System behavior matches the requirement detail: $RequirementLine"
        priority = 'P1'
        testType = 'Functional'
        notes = 'Generated from InputPath parsing. Review source material for edge cases and implicit rules.'
    }
}

function Convert-StructuredFilesToData {
    param(
        [object[]]$Files,
        [string]$SourceName,
        [string]$SourceType
    )

    $requirementSummary = New-Object System.Collections.Generic.List[string]
    $testScope = New-Object System.Collections.Generic.List[string]
    $openQuestions = New-Object System.Collections.Generic.List[string]
    $risks = New-Object System.Collections.Generic.List[string]
    $testCases = New-Object System.Collections.Generic.List[object]
    $counter = 1

    foreach ($file in $Files) {
        foreach ($module in @($file.StructuredModules)) {
            if (-not ($testScope -contains $module.ModuleName)) {
                $testScope.Add($module.ModuleName)
            }

            foreach ($requirement in @($module.Requirements)) {
                $text = [string]$requirement.Text
                if ([string]::IsNullOrWhiteSpace($text)) {
                    continue
                }

                if ($requirementSummary.Count -lt 6 -and -not ($requirementSummary -contains $text)) {
                    $requirementSummary.Add($text)
                }

                $id = 'PATH-{0:d3}' -f $counter
                $counter += 1
                $testCases.Add((New-TestCaseFromStructuredRequirement -Id $id -ModuleName $module.ModuleName -ScenarioName ([string]$requirement.Scenario) -RequirementText $text))
            }
        }
    }

    $openQuestions.Add('已按标题、列表和正文结构生成测试用例；仍建议补充权限、接口校验和异常链路约束。')
    $risks.Add('若源文档未使用规范标题样式，模块或场景划分可能退化为基于文本的近似识别。')

    return [pscustomobject][ordered]@{
        prefix = 'PATH'
        documentSummary = [pscustomobject][ordered]@{
            name = $SourceName
            type = $SourceType
            parseResult = "Parsed structured requirement content from $($Files.Count) file(s) through InputPath."
            missingInfo = '图片内容、修订痕迹、批注和复杂嵌套表格可能无法完整还原。'
        }
        requirementSummary = @($requirementSummary.ToArray())
        openQuestions = @($openQuestions.ToArray())
        testScope = @($testScope.ToArray())
        risks = @($risks.ToArray())
        testCases = @($testCases.ToArray())
    }
}

function Convert-InputFilesToData {
    param(
        [object[]]$Files,
        [string]$SourceName,
        [string]$SourceType
    )

    $requirementSummary = New-Object System.Collections.Generic.List[string]
    $testScope = New-Object System.Collections.Generic.List[string]
    $openQuestions = New-Object System.Collections.Generic.List[string]
    $risks = New-Object System.Collections.Generic.List[string]
    $testCases = New-Object System.Collections.Generic.List[object]
    $counter = 1

    $structuredFiles = @($Files | Where-Object { $_.PSObject.Properties.Name -contains 'StructuredModules' -and @($_.StructuredModules).Count -gt 0 })
    $plainFiles = @($Files | Where-Object { -not ($_.PSObject.Properties.Name -contains 'StructuredModules' -and @($_.StructuredModules).Count -gt 0) })

    if ($structuredFiles.Count -gt 0 -and $plainFiles.Count -eq 0) {
        return Convert-StructuredFilesToData -Files $structuredFiles -SourceName $SourceName -SourceType $SourceType
    }

    foreach ($file in $Files) {
        if ($file.PSObject.Properties.Name -contains 'StructuredModules' -and @($file.StructuredModules).Count -gt 0) {
            foreach ($module in @($file.StructuredModules)) {
                $moduleName = [string]$module.ModuleName
                $lines = @($module.Requirements | ForEach-Object { [string]$_.Text })
                if ($lines.Count -eq 0) {
                    $lines = @("$moduleName 对应需求文件内容较少，需要补充明确业务规则。")
                }

                if (-not ($testScope -contains $moduleName)) {
                    $testScope.Add($moduleName)
                }

                foreach ($line in ($lines | Select-Object -First 3)) {
                    if (-not ($requirementSummary -contains $line)) {
                        $requirementSummary.Add($line)
                    }
                }

                foreach ($line in ($lines | Select-Object -First 3)) {
                    $id = 'PATH-{0:d3}' -f $counter
                    $counter += 1
                    $testCases.Add((New-TestCaseFromRequirement -Id $id -ModuleName $moduleName -RequirementLine $line))
                }
            }

            continue
        }

        $moduleName = [string]$file.ModuleName
        $lines = @($file.Lines)
        if ($lines.Count -eq 0) {
            $lines = @("$moduleName 对应需求文件内容较少，需要补充明确业务规则。")
        }

        $testScope.Add($moduleName)

        foreach ($line in ($lines | Select-Object -First 3)) {
            if (-not ($requirementSummary -contains $line)) {
                $requirementSummary.Add($line)
            }
        }

        foreach ($line in ($lines | Select-Object -First 3)) {
            $id = 'PATH-{0:d3}' -f $counter
            $counter += 1
            $testCases.Add((New-TestCaseFromRequirement -Id $id -ModuleName $moduleName -RequirementLine $line))
        }
    }

    $openQuestions.Add('Generated from visible text only. Confirm interactive details, API validations, and permission rules against the source requirements.')
    $risks.Add('Generated cases focus on explicit text rules. Hidden business constraints and cross-page interactions may still need manual coverage.')

    return [pscustomobject][ordered]@{
        prefix = 'PATH'
        documentSummary = [pscustomobject][ordered]@{
            name = $SourceName
            type = $SourceType
            parseResult = "Parsed visible text from $($Files.Count) file(s) through InputPath."
            missingInfo = 'Image-only content, comments, revisions, hidden regions, or complex tables may not be fully captured.'
        }
        requirementSummary = @($requirementSummary.ToArray())
        openQuestions = @($openQuestions.ToArray())
        testScope = @($testScope.ToArray())
        risks = @($risks.ToArray())
        testCases = @($testCases.ToArray())
    }
}

function Convert-InputPathToData {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Input path not found: $Path"
    }

    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
    $item = Get-Item -LiteralPath $resolvedPath

    if ($item.PSIsContainer) {
        $files = @(Get-ChildItem -LiteralPath $resolvedPath -File | Where-Object { Test-SupportedInputExtension -Extension (Get-InputExtension -Path $_.FullName) } | Sort-Object Name)
        if ($files.Count -eq 0) {
            throw "No supported files found in directory: $resolvedPath"
        }

        $modules = New-Object System.Collections.Generic.List[object]
        foreach ($file in $files) {
            $fallbackModuleName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
            $structuredItems = @(Get-StructuredContentFromFile -Path $file.FullName)
            $structuredModules = @(Convert-StructuredItemsToModules -Items $structuredItems -FallbackModuleName $fallbackModuleName)
            if ($structuredModules.Count -gt 0) {
                $modules.Add([pscustomobject][ordered]@{
                    ModuleName = $fallbackModuleName
                    Path = $file.FullName
                    StructuredModules = $structuredModules
                })
                continue
            }

            $text = Get-PlainTextFromFile -Path $file.FullName
            $lines = @(Get-MeaningfulLines -Text $text)
            $modules.Add([pscustomobject][ordered]@{
                ModuleName = $fallbackModuleName
                Path = $file.FullName
                Lines = $lines
            })
        }

        return [pscustomobject][ordered]@{
            Data = Convert-InputFilesToData -Files @($modules.ToArray()) -SourceName $item.Name -SourceType 'input-directory'
            InputSource = $resolvedPath
            DefaultMerge = $true
        }
    }

    $extension = Get-InputExtension -Path $resolvedPath
    if (-not (Test-SupportedInputExtension -Extension $extension)) {
        throw "unsupported input file type: $extension"
    }

    $fallbackModuleName = [System.IO.Path]::GetFileNameWithoutExtension($item.Name)
    $structuredItems = @(Get-StructuredContentFromFile -Path $resolvedPath)
    $structuredModules = @(Convert-StructuredItemsToModules -Items $structuredItems -FallbackModuleName $fallbackModuleName)
    if ($structuredModules.Count -gt 0) {
        $module = [pscustomobject][ordered]@{
            ModuleName = $fallbackModuleName
            Path = $resolvedPath
            StructuredModules = $structuredModules
        }
    }
    else {
        $text = Get-PlainTextFromFile -Path $resolvedPath
        $lines = @(Get-MeaningfulLines -Text $text)
        $module = [pscustomobject][ordered]@{
            ModuleName = $fallbackModuleName
            Path = $resolvedPath
            Lines = $lines
        }
    }

    return [pscustomobject][ordered]@{
        Data = Convert-InputFilesToData -Files @($module) -SourceName ([System.IO.Path]::GetFileNameWithoutExtension($item.Name)) -SourceType 'input-file'
        InputSource = $resolvedPath
        DefaultMerge = $true
    }
}

function Get-ModuleDataGroups {
    param([pscustomobject]$Data)

    $groupedCases = [ordered]@{}
    foreach ($testcase in @($Data.testCases)) {
        $moduleName = if ([string]::IsNullOrWhiteSpace([string]$testcase.module)) { '未分类模块' } else { [string]$testcase.module }
        if (-not $groupedCases.Contains($moduleName)) {
            $groupedCases[$moduleName] = New-Object System.Collections.Generic.List[object]
        }

        $groupedCases[$moduleName].Add($testcase)
    }

    $groups = New-Object System.Collections.Generic.List[object]
    foreach ($moduleName in $groupedCases.Keys) {
        $moduleCases = @($groupedCases[$moduleName].ToArray())
        $moduleData = [pscustomobject][ordered]@{
            prefix = if ($Data.prefix) { [string]$Data.prefix } else { $null }
            documentSummary = $Data.documentSummary
            requirementSummary = @($Data.requirementSummary)
            openQuestions = @($Data.openQuestions)
            testScope = @($Data.testScope)
            risks = @($Data.risks)
            testCases = $moduleCases
            moduleName = $moduleName
        }
        $groups.Add($moduleData)
    }

    return @($groups.ToArray())
}

function New-ExportResultItem {
    param(
        [string]$Type,
        [string]$Path,
        [string]$Status,
        [string]$FailureReason
    )

    return [pscustomobject][ordered]@{
        type = $Type
        path = Get-AbsolutePath -Path $Path
        status = $Status
        failureReason = $FailureReason
    }
}

function ConvertTo-XmlText {
    param([AllowNull()][string]$Value)

    if ($null -eq $Value) {
        return ''
    }

    return [System.Security.SecurityElement]::Escape([string]$Value)
}

function Get-TopicField {
    param(
        $Topic,
        [string]$Name
    )

    if ($Topic -is [System.Collections.IDictionary]) {
        return $Topic[$Name]
    }

    return $Topic.$Name
}

function New-XmindXmlTopic {
    param(
        [hashtable]$Topic,
        [bool]$IsRoot = $false
    )

    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $title = ConvertTo-XmlText -Value (Get-TopicField -Topic $Topic -Name 'title')
    $topicId = [string](Get-TopicField -Topic $Topic -Name 'id')
    $attrs = "id=`"$topicId`" modified-by=`"OpenCode`" timestamp=`"$timestamp`""
    if ($IsRoot) {
        $attrs += " structure-class=`"org.xmind.ui.logic.right`""
    }

    $xml = "<topic $attrs><title>$title</title>"
    $children = @(Get-TopicField -Topic $Topic -Name 'children')
    if ($children.Count -gt 0) {
        $xml += "<children><topics type=`"attached`">"
        foreach ($child in $children) {
            $xml += New-XmindXmlTopic -Topic $child
        }
        $xml += "</topics></children>"
    }
    $xml += "</topic>"
    return $xml
}

function New-XmindXmlDocument {
    param(
        [hashtable]$RootTopic,
        [string]$WorkbookTitle
    )

    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $sheetId = [guid]::NewGuid().ToString('N')
    $themeId = [guid]::NewGuid().ToString('N')
    $sheetTitle = ConvertTo-XmlText -Value $WorkbookTitle
    $topicXml = New-XmindXmlTopic -Topic $RootTopic -IsRoot $true

    return "<?xml version=`"1.0`" encoding=`"UTF-8`" standalone=`"no`"?><xmap-content xmlns=`"urn:xmind:xmap:xmlns:content:2.0`" xmlns:fo=`"http://www.w3.org/1999/XSL/Format`" xmlns:svg=`"http://www.w3.org/2000/svg`" xmlns:xhtml=`"http://www.w3.org/1999/xhtml`" xmlns:xlink=`"http://www.w3.org/1999/xlink`" modified-by=`"OpenCode`" timestamp=`"$timestamp`" version=`"2.0`"><sheet id=`"$sheetId`" modified-by=`"OpenCode`" theme=`"$themeId`" timestamp=`"$timestamp`">$topicXml<title>$sheetTitle</title></sheet></xmap-content>"
}

function ConvertTo-SharedStringCell {
    param(
        [int]$StringIndex,
        [int]$RowIndex,
        [int]$ColumnIndex
    )

    $columnName = ConvertTo-ExcelColumnName -ColumnIndex $ColumnIndex
    return "<c r=`"$columnName$RowIndex`" t=`"s`"><v>$StringIndex</v></c>"
}

function ConvertTo-ExcelColumnName {
    param([int]$ColumnIndex)

    $dividend = $ColumnIndex
    $columnName = ''
    while ($dividend -gt 0) {
        $modulo = ($dividend - 1) % 26
        $columnName = [char](65 + $modulo) + $columnName
        $dividend = [math]::Floor(($dividend - $modulo) / 26)
    }

    return $columnName
}

function New-MarkdownContent {
    param([pscustomobject]$Data)

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('# 测试用例导出')
    $lines.Add('')

    $sections = @(
        @{ Title = '待确认问题'; Items = $Data.openQuestions },
        @{ Title = '测试范围'; Items = $Data.testScope },
        @{ Title = '风险提示'; Items = $Data.risks }
    )

    foreach ($section in $sections) {
        $lines.Add("## $($section.Title)")
        $lines.Add('')
        $items = @($section.Items)
        if ($items.Count -eq 0) {
            $lines.Add('- 无')
        } else {
            foreach ($item in $items) {
                $lines.Add("- $item")
            }
        }
        $lines.Add('')
    }

    $lines.Add('## 测试用例')
    $lines.Add('')
    $lines.Add('| 功能模块 | 场景分类 | 用例标题 | 测试步骤 | 预期结果 | 优先级 | 测试类型 |')
    $lines.Add('|---|---|---|---|---|---|---|')

    foreach ($testcase in @($Data.testCases)) {
        $stepsText = @($testcase.steps) -join '；'
        $line = "| $($testcase.module) | $($testcase.scenario) | $($testcase.title) | $stepsText | $($testcase.expectedResult) | $($testcase.priority) | $($testcase.testType) |"
        $lines.Add($line)
    }

    return ($lines -join [Environment]::NewLine)
}

function New-XlsxFile {
    param(
        [pscustomobject]$Data,
        [string]$OutputPath
    )

    $headers = @('功能模块', '场景分类', '用例标题', '测试步骤', '预期结果', '优先级', '测试类型')
    $rows = New-Object System.Collections.Generic.List[object[]]
    $rows.Add($headers)

    foreach ($testcase in @($Data.testCases)) {
        $rows.Add(@(
            [string]$testcase.module,
            [string]$testcase.scenario,
            [string]$testcase.title,
            [string](@($testcase.steps) -join '；'),
            [string]$testcase.expectedResult,
            [string]$testcase.priority,
            [string]$testcase.testType
        ))
    }

    $stringIndexMap = @{}
    $sharedStrings = New-Object System.Collections.Generic.List[string]
    $sheetRows = New-Object System.Collections.Generic.List[string]

    for ($rowIndex = 0; $rowIndex -lt $rows.Count; $rowIndex++) {
        $cells = New-Object System.Collections.Generic.List[string]
        $row = $rows[$rowIndex]
        for ($columnIndex = 0; $columnIndex -lt $row.Length; $columnIndex++) {
            $value = if ($null -eq $row[$columnIndex]) { '' } else { [string]$row[$columnIndex] }
            if (-not $stringIndexMap.ContainsKey($value)) {
                $stringIndexMap[$value] = $sharedStrings.Count
                $sharedStrings.Add($value)
            }

            $cells.Add((ConvertTo-SharedStringCell -StringIndex $stringIndexMap[$value] -RowIndex ($rowIndex + 1) -ColumnIndex ($columnIndex + 1)))
        }

        $sheetRows.Add("<row r=`"$($rowIndex + 1)`">$($cells -join '')</row>")
    }

    $sharedStringItems = foreach ($value in $sharedStrings) {
        "<si><t xml:space=`"preserve`">$(ConvertTo-XmlText $value)</t></si>"
    }

    $sheetData = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView workbookViewId="0"/>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <sheetData>
    $($sheetRows -join [Environment]::NewLine)
  </sheetData>
</worksheet>
"@

    $sharedStringsXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="$($sharedStrings.Count)" uniqueCount="$($sharedStrings.Count)">
  $($sharedStringItems -join [Environment]::NewLine)
</sst>
"@

    $workbookXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="TestCases" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>
"@

    $stylesXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>
"@

    $contentTypesXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
"@

    $relsXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"@

    $workbookRelsXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>
"@

    $created = (Get-Date).ToUniversalTime().ToString('s') + 'Z'
    $coreXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>TestCases</dc:title>
  <dc:creator>OpenCode</dc:creator>
  <cp:lastModifiedBy>OpenCode</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">$created</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">$created</dcterms:modified>
</cp:coreProperties>
"@

    $appXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>OpenCode</Application>
</Properties>
"@

    if (Test-Path -LiteralPath $OutputPath) {
        Remove-Item -LiteralPath $OutputPath -Force
    }

    $zip = [System.IO.Compression.ZipFile]::Open($OutputPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $entries = @{
            '[Content_Types].xml' = $contentTypesXml
            '_rels/.rels' = $relsXml
            'docProps/core.xml' = $coreXml
            'docProps/app.xml' = $appXml
            'xl/workbook.xml' = $workbookXml
            'xl/_rels/workbook.xml.rels' = $workbookRelsXml
            'xl/styles.xml' = $stylesXml
            'xl/sharedStrings.xml' = $sharedStringsXml
            'xl/worksheets/sheet1.xml' = $sheetData
        }

        foreach ($entryPath in $entries.Keys) {
            $entry = $zip.CreateEntry($entryPath)
            $writer = New-Object System.IO.StreamWriter($entry.Open(), [System.Text.UTF8Encoding]::new($false))
            try {
                $writer.Write($entries[$entryPath])
            }
            finally {
                $writer.Dispose()
            }
        }
    }
    finally {
        $zip.Dispose()
    }
}

function New-XmindTopic {
    param(
        [string]$Title,
        [array]$Children
    )

    $topic = [ordered]@{
        id = [guid]::NewGuid().ToString('N')
        title = $Title
    }

    if ($Children -and $Children.Count -gt 0) {
        $topic.children = [ordered]@{
            attached = $Children
        }
    }

    return $topic
}

function New-XmindTreeNode {
    param(
        [string]$Title,
        [array]$Children
    )

    return @{
        id = [guid]::NewGuid().ToString('N')
        title = $Title
        children = @($Children)
    }
}

function ConvertTo-XmindJsonTopic {
    param(
        [hashtable]$Node,
        [bool]$IsRoot = $false
    )

    $topic = [ordered]@{
        id = $Node.id
        title = $Node.title
        attributedTitle = @(
            [ordered]@{
                text = $Node.title
            }
        )
    }

    if ($IsRoot) {
        $topic.class = 'topic'
        $topic.structureClass = 'org.xmind.ui.logic.right'
    }

    $children = @($Node.children)
    if ($children.Count -gt 0) {
        $attached = @()
        foreach ($child in $children) {
            $attached += ,(ConvertTo-XmindJsonTopic -Node $child)
        }
        $topic.children = [ordered]@{
            attached = $attached
        }
    }

    return $topic
}

function Set-ZipEntryText {
    param(
        [System.IO.Compression.ZipArchive]$Zip,
        [string]$EntryName,
        [string]$Content
    )

    $existing = $Zip.GetEntry($EntryName)
    if ($null -ne $existing) {
        $existing.Delete()
    }

    $entry = $Zip.CreateEntry($EntryName)
    $writer = New-Object System.IO.StreamWriter($entry.Open(), [System.Text.UTF8Encoding]::new($false))
    try {
        $writer.Write($Content)
    }
    finally {
        $writer.Dispose()
    }
}

function Set-ObjectProperty {
    param(
        [object]$Target,
        [string]$Name,
        $Value
    )

    if ($Target.PSObject.Properties.Name -contains $Name) {
        $Target.$Name = $Value
    }
    else {
        $Target | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function New-XmindFromTemplate {
    param(
        [string]$TemplatePath,
        [hashtable]$RootTopic,
        [string]$WorkbookTitle,
        [string]$OutputPath
    )

    Copy-Item -LiteralPath $TemplatePath -Destination $OutputPath -Force

    $zip = [System.IO.Compression.ZipFile]::Open($OutputPath, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        $contentEntry = $zip.GetEntry('content.json')
        if ($null -eq $contentEntry) {
            throw "Template does not contain content.json: $TemplatePath"
        }

        $reader = New-Object System.IO.StreamReader($contentEntry.Open(), [System.Text.Encoding]::UTF8)
        try {
            $contentText = $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
        }

        $workbook = $contentText | ConvertFrom-Json
        if ($workbook.Count -lt 1) {
            throw "Template content.json has no sheets: $TemplatePath"
        }

        $sheet = $workbook[0]
        Set-ObjectProperty -Target $sheet -Name 'id' -Value ([guid]::NewGuid().ToString('N'))
        Set-ObjectProperty -Target $sheet -Name 'revisionId' -Value ([guid]::NewGuid().ToString())
        Set-ObjectProperty -Target $sheet -Name 'title' -Value 'Sheet 1'
        Set-ObjectProperty -Target $sheet -Name 'rootTopic' -Value (ConvertTo-XmindJsonTopic -Node $RootTopic -IsRoot $true)
        Set-ObjectProperty -Target $sheet -Name 'arrangeableLayerOrder' -Value @($sheet.rootTopic.id)
        Set-ObjectProperty -Target $sheet -Name 'zones' -Value @()
        if ($sheet.PSObject.Properties.Name -contains 'extensions') {
            $sheet.extensions = @(
                [ordered]@{
                    provider = 'org.xmind.ui.skeleton.structure.style'
                    content = [ordered]@{
                        centralTopic = 'org.xmind.ui.logic.right'
                    }
                }
            )
        }

        $sheetJson = $sheet | ConvertTo-Json -Depth 100 -Compress
        $contentJson = '[' + $sheetJson + ']'
        Set-ZipEntryText -Zip $zip -EntryName 'content.json' -Content $contentJson

        $metadata = [ordered]@{
            dataStructureVersion = '3'
            layoutEngineVersion = '5'
            creator = [ordered]@{
                name = 'OpenCode'
                version = '1.0'
            }
        } | ConvertTo-Json -Depth 20 -Compress
        Set-ZipEntryText -Zip $zip -EntryName 'metadata.json' -Content $metadata

        $manifest = [ordered]@{
            'file-entries' = [ordered]@{
                'content.json' = @{}
                'metadata.json' = @{}
                'Thumbnails/thumbnail.png' = @{}
            }
        } | ConvertTo-Json -Depth 20 -Compress
        Set-ZipEntryText -Zip $zip -EntryName 'manifest.json' -Content $manifest
    }
    finally {
        $zip.Dispose()
    }
}

function New-XmindFile {
    param(
        [pscustomobject]$Data,
        [string]$OutputPath,
        [string]$WorkbookTitle,
        [string]$TemplatePath
    )

    $moduleGroups = [ordered]@{}
    foreach ($testcase in @($Data.testCases)) {
        $moduleName = if ([string]::IsNullOrWhiteSpace([string]$testcase.module)) { '未分类模块' } else { [string]$testcase.module }
        $scenarioName = if ([string]::IsNullOrWhiteSpace([string]$testcase.scenario)) { '未分类场景' } else { [string]$testcase.scenario }

        if (-not $moduleGroups.Contains($moduleName)) {
            $moduleGroups[$moduleName] = [ordered]@{}
        }

        if (-not $moduleGroups[$moduleName].Contains($scenarioName)) {
            $moduleGroups[$moduleName][$scenarioName] = New-Object System.Collections.Generic.List[hashtable]
        }

        $caseNode = New-XmindTreeNode -Title ([string]$testcase.title) -Children @(
            (New-XmindTreeNode -Title ("测试步骤：" + [string](@($testcase.steps) -join '；')) -Children @()),
            (New-XmindTreeNode -Title ("预期结果：" + [string]$testcase.expectedResult) -Children @()),
            (New-XmindTreeNode -Title ("优先级：" + [string]$testcase.priority) -Children @()),
            (New-XmindTreeNode -Title ("测试类型：" + [string]$testcase.testType) -Children @())
        )

        $moduleGroups[$moduleName][$scenarioName].Add($caseNode)
    }

    $moduleTopics = New-Object System.Collections.Generic.List[hashtable]
    foreach ($moduleName in $moduleGroups.Keys) {
        $scenarioTopics = New-Object System.Collections.Generic.List[hashtable]
        foreach ($scenarioName in $moduleGroups[$moduleName].Keys) {
            $scenarioTopics.Add((New-XmindTreeNode -Title $scenarioName -Children @($moduleGroups[$moduleName][$scenarioName].ToArray())))
        }
        $moduleTopics.Add((New-XmindTreeNode -Title $moduleName -Children @($scenarioTopics.ToArray())))
    }

    $rootTopic = @{
        id = [guid]::NewGuid().ToString('N')
        title = $WorkbookTitle
        children = @($moduleTopics.ToArray())
    }

    if (Test-Path -LiteralPath $OutputPath) {
        Remove-Item -LiteralPath $OutputPath -Force
    }

    if (-not $TemplatePath) {
        $TemplatePath = Get-DefaultXmindTemplate
    }

    if ($TemplatePath -and (Test-Path -LiteralPath $TemplatePath)) {
        New-XmindFromTemplate -TemplatePath $TemplatePath -RootTopic $rootTopic -WorkbookTitle $WorkbookTitle -OutputPath $OutputPath
        return
    }

    $metadata = @{}

    $manifest = [ordered]@{
        'file-entries' = [ordered]@{
            'content.xml' = @{}
            'metadata.json' = @{}
        }
    }

    $contentXml = New-XmindXmlDocument -RootTopic $rootTopic -WorkbookTitle $WorkbookTitle

    $zip = [System.IO.Compression.ZipFile]::Open($OutputPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $metadataEntry = $zip.CreateEntry('metadata.json')
        $metadataWriter = New-Object System.IO.StreamWriter($metadataEntry.Open(), [System.Text.UTF8Encoding]::new($false))
        try {
            $metadataWriter.Write(($metadata | ConvertTo-Json -Depth 10))
        }
        finally {
            $metadataWriter.Dispose()
        }

        $contentXmlEntry = $zip.CreateEntry('content.xml')
        $contentXmlWriter = New-Object System.IO.StreamWriter($contentXmlEntry.Open(), [System.Text.UTF8Encoding]::new($false))
        try {
            $contentXmlWriter.Write($contentXml)
        }
        finally {
            $contentXmlWriter.Dispose()
        }

        $manifestEntry = $zip.CreateEntry('manifest.json')
        $manifestWriter = New-Object System.IO.StreamWriter($manifestEntry.Open(), [System.Text.UTF8Encoding]::new($false))
        try {
            $manifestWriter.Write(($manifest | ConvertTo-Json -Depth 10 -Compress))
        }
        finally {
            $manifestWriter.Dispose()
        }
    }
    finally {
        $zip.Dispose()
    }
}

if (-not [string]::IsNullOrWhiteSpace($InputJson)) {
    if (-not (Test-Path -LiteralPath $InputJson)) {
        throw "Input JSON not found: $InputJson"
    }

    $rawJson = Get-Content -LiteralPath $InputJson -Raw -Encoding UTF8
    $inputSource = (Resolve-Path -LiteralPath $InputJson).Path
    $data = $rawJson | ConvertFrom-Json
    $effectiveNoSplitByModule = -not $SplitByModule.IsPresent
}
elseif (-not [string]::IsNullOrWhiteSpace($InputPath)) {
    $pathResult = Convert-InputPathToData -Path $InputPath
    $data = $pathResult.Data
    $inputSource = $pathResult.InputSource
    $effectiveNoSplitByModule = -not $SplitByModule.IsPresent
}
else {
    $rawJson = $InputJsonText
    $inputSource = if ($hasUrl) { "url:$InputUrl" } else { 'inline-json' }
    $data = $rawJson | ConvertFrom-Json
    $effectiveNoSplitByModule = -not $SplitByModule.IsPresent
}

if ($Preview.IsPresent) {
    $allCases = @($data.testCases)
    $moduleStats = [ordered]@{}
    $totalP1 = 0
    foreach ($tc in $allCases) {
        $mod = if ([string]::IsNullOrWhiteSpace([string]$tc.module)) { '未分类模块' } else { [string]$tc.module }
        $scn = if ([string]::IsNullOrWhiteSpace([string]$tc.scenario)) { '未分类场景' } else { [string]$tc.scenario }
        if (-not $moduleStats.Contains($mod)) {
            $moduleStats[$mod] = [ordered]@{ total = 0; p1 = 0; scenarios = [ordered]@{} }
        }
        $moduleStats[$mod].total++
        if ([string]$tc.priority -eq 'P1') { $moduleStats[$mod].p1++; $totalP1++ }
        if (-not $moduleStats[$mod].scenarios.Contains($scn)) { $moduleStats[$mod].scenarios[$scn] = 0 }
        $moduleStats[$mod].scenarios[$scn]++
    }
    $previewResult = [ordered]@{
        preview = $true
        inputSource = $inputSource
        documentSummary = $data.documentSummary
        requirementSummary = @($data.requirementSummary)
        testScope = @($data.testScope)
        risks = @($data.risks)
        openQuestions = @($data.openQuestions)
        totalTestCases = $allCases.Count
        totalP1 = $totalP1
        modules = $moduleStats
    }
    $previewResult | ConvertTo-Json -Depth 10
    exit 0
}

if (-not $OutputDir) {
    $defaultName = if ($data -and $data.documentSummary -and $data.documentSummary.name) {
        $data.documentSummary.name
    } else {
        '测试用例'
    }
    $safeName = Get-SafeFileName -Name $defaultName
    $OutputDir = Join-Path (Get-Location) "exports/$safeName"
}

Ensure-Directory -Path $OutputDir

$moduleResults = New-Object System.Collections.Generic.List[object]

$moduleDataList = if ($effectiveNoSplitByModule) {
    @([pscustomobject][ordered]@{
        prefix = if ($data.prefix) { [string]$data.prefix } else { $null }
        documentSummary = $data.documentSummary
        requirementSummary = @($data.requirementSummary)
        openQuestions = @($data.openQuestions)
        testScope = @($data.testScope)
        risks = @($data.risks)
        testCases = @($data.testCases)
        moduleName = if ($data.documentSummary -and $data.documentSummary.name) { [string]$data.documentSummary.name } else { '合并测试用例' }
    })
}
else {
    @(Get-ModuleDataGroups -Data $data)
}

foreach ($moduleData in $moduleDataList) {
    $moduleName = [string]$moduleData.moduleName
    $moduleOutputDir = if ($effectiveNoSplitByModule) { $OutputDir } else { Join-Path $OutputDir (Get-ModuleDirectoryName -ModuleName $moduleName) }
    Ensure-Directory -Path $moduleOutputDir

    $baseFileName = if ($effectiveNoSplitByModule) { Get-SafeFileName -Name $moduleName } else { 'testcases' }
    $markdownPath = Join-Path $moduleOutputDir "$baseFileName.md"
    $xlsxPath = Join-Path $moduleOutputDir "$baseFileName.xlsx"
    $xmindPath = Join-Path $moduleOutputDir "$baseFileName.xmind"
    $exportResults = @()

    try {
        $markdownContent = New-MarkdownContent -Data $moduleData
        [System.IO.File]::WriteAllText($markdownPath, $markdownContent, [System.Text.UTF8Encoding]::new($false))
        $exportResults += New-ExportResultItem -Type 'markdown' -Path $markdownPath -Status 'success' -FailureReason ''
    }
    catch {
        Remove-FileIfExists -Path $markdownPath
        $exportResults += New-ExportResultItem -Type 'markdown' -Path $markdownPath -Status 'failed' -FailureReason $_.Exception.Message
    }

    try {
        New-XlsxFile -Data $moduleData -OutputPath $xlsxPath
        $exportResults += New-ExportResultItem -Type 'excel' -Path $xlsxPath -Status 'success' -FailureReason ''
    }
    catch {
        Remove-FileIfExists -Path $xlsxPath
        $exportResults += New-ExportResultItem -Type 'excel' -Path $xlsxPath -Status 'failed' -FailureReason $_.Exception.Message
    }

    $workbookTitle = $moduleName
    try {
        New-XmindFile -Data $moduleData -OutputPath $xmindPath -WorkbookTitle $workbookTitle -TemplatePath $XmindTemplate
        $exportResults += New-ExportResultItem -Type 'xmind' -Path $xmindPath -Status 'success' -FailureReason ''
    }
    catch {
        Remove-FileIfExists -Path $xmindPath
        $exportResults += New-ExportResultItem -Type 'xmind' -Path $xmindPath -Status 'failed' -FailureReason $_.Exception.Message
    }

    $successfulTypes = @($exportResults | Where-Object { $_.status -eq 'success' } | ForEach-Object { $_.type })
    $failedTypes = @($exportResults | Where-Object { $_.status -eq 'failed' } | ForEach-Object { $_.type })
    $allSucceeded = ($failedTypes.Count -eq 0)
    $hasDegradation = ($successfulTypes.Count -gt 0 -and $failedTypes.Count -gt 0)

    $moduleResults.Add([pscustomobject][ordered]@{
        module = $moduleName
        outputDir = (Get-AbsolutePath -Path $moduleOutputDir)
        files = [ordered]@{
            markdown = (Get-AbsolutePath -Path $markdownPath)
            excel = (Get-AbsolutePath -Path $xlsxPath)
            xmind = (Get-AbsolutePath -Path $xmindPath)
        }
        summary = [ordered]@{
            successfulTypes = @($successfulTypes)
            failedTypes = @($failedTypes)
            hasDegradation = $hasDegradation
            allSucceeded = $allSucceeded
        }
    })
}

$result = [ordered]@{
    inputJson = $inputSource
    outputDir = (Get-AbsolutePath -Path $OutputDir)
    modules = @($moduleResults.ToArray())
}

$result | ConvertTo-Json -Depth 10
