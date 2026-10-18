; Crypthy NSIS 추가 스크립트 (electron-builder nsis.include)
;
; 업데이트(silent) 설치는 앱 파일 교체가 실패해도 오류를 무시하고 덮어쓴 뒤 --force-run 으로 앱을 실행한다
; (electron-builder 템플릿의 extractUsing7za 마지막 수단). 그러면 반쯤 쓰인 Crypthy.exe 가 실행되어
; "이 앱을 실행할 수 없습니다" 가 뜬다. 여기서는 파일 복사가 끝난 직후 실행 파일의 버전이 이 설치 파일의
; 버전과 같은지 확인하고, 다르면(없음·손상·이전 파일) 실행하지 않고 알린 뒤 오류 코드 2로 끝낸다.
; 사용자 데이터(%APPDATA%\Crypthy)는 건드리지 않는다.

!macro customInstall
  StrCpy $R8 ""
  ClearErrors
  GetDLLVersion "$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R6 $R7
  ${ifNot} ${Errors}
    IntOp $R2 $R6 >> 16
    IntOp $R2 $R2 & 0xFFFF
    IntOp $R3 $R6 & 0xFFFF
    IntOp $R4 $R7 >> 16
    IntOp $R4 $R4 & 0xFFFF
    StrCpy $R8 "$R2.$R3.$R4"
  ${endIf}
  ${if} $R8 != "${VERSION}"
  ${orIfNot} ${FileExists} "$INSTDIR\resources\app.asar"
    DetailPrint "Crypthy install check failed: executable version '$R8', expected '${VERSION}'"
    ; CI 스모크 테스트는 창 없이 확인한다
    ReadEnvStr $R9 CRYPTHY_INSTALLER_NO_UI
    ${if} $R9 == ""
      ; silent 설치에서도 보이도록 MessageBox 대신 user32 를 직접 부른다
      ; System::Call 인자는 쉼표로 나뉘므로 문장은 레지스터에 담아 넘긴다
      StrCpy $R5 "Crypthy ${VERSION} 설치를 마치지 못했습니다 (앱 파일을 바꾸지 못함).$\r$\n$\r$\n열리는 GitHub Releases 페이지에서 Crypthy-${VERSION}-setup-x64.exe 를 받아 다시 설치해 주세요. 설정과 기록(%APPDATA%\Crypthy)은 그대로 남아 있습니다.$\r$\n$\r$\nCrypthy ${VERSION} could not replace the app files. Download the installer from GitHub Releases and run it again. Your settings and data are kept."
      System::Call 'user32::MessageBoxW(p 0, w R5, w "Crypthy", i 0x10)'
      ExecShell "open" "https://github.com/Ruderud/crypthy/releases/tag/v${VERSION}"
    ${endIf}
    SetErrorLevel 2
    Quit
  ${endIf}
!macroend
