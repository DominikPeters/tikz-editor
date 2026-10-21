; Shared preference with update_preferences.rs and update-checks.wxs.
!include nsDialogs.nsh
!include LogicLib.nsh
!define TIKZ_UPDATE_KEY "Software\TikZEditor\Preferences"
Var TikzUpdateChecks
Var TikzUpdateCheckbox
Var TikzUpdatePageVisited
!macro NSIS_HOOK_POSTINSTALL
  ; A skipped page must never reset preferences during an upgrade.
  ${If} $TikzUpdatePageVisited == 1
    WriteRegStr HKCU "${TIKZ_UPDATE_KEY}" "AutomaticUpdateChecks" "$TikzUpdateChecks"
  ${EndIf}
!macroend

!macro TIKZ_UPDATE_PAGE_FUNCTIONS
Function TikzUpdateChecksPage
  ; Passive updates and silent installs preserve the previous choice.
  Call SkipIfPassive
  !insertmacro MUI_HEADER_TEXT "Update checks" "Choose your update preference."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${If} $TikzUpdatePageVisited != 1
    ClearErrors
    ReadRegStr $TikzUpdateChecks HKCU "${TIKZ_UPDATE_KEY}" "AutomaticUpdateChecks"
    ${If} ${Errors}
      StrCpy $TikzUpdateChecks "1"
    ${EndIf}
    StrCpy $TikzUpdatePageVisited 1
  ${EndIf}
  ${NSD_CreateCheckbox} 0 20u 100% 24u "Automatically check for updates when TikZ Editor starts"
  Pop $TikzUpdateCheckbox
  ${If} $TikzUpdateChecks == "1"
    ${NSD_Check} $TikzUpdateCheckbox
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function TikzUpdateChecksLeave
  ${NSD_GetState} $TikzUpdateCheckbox $0
  StrCpy $TikzUpdateChecks "0"
  ${If} $0 == ${BST_CHECKED}
    StrCpy $TikzUpdateChecks "1"
  ${EndIf}
FunctionEnd

!macroend
