; 安装 / 升级时若「直播运营助手」仍在运行，强制结束进程树，
; 避免弹出「无法关闭，请手动关闭后重试」。
!macro customCheckAppRunning
  DetailPrint "Closing running ${PRODUCT_NAME} (force)..."
  ; /F 强制 /T 结束进程树；不弹 MessageBox，直接继续安装
  nsExec::ExecToLog `taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T`
  Sleep 600
  nsExec::ExecToLog `taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T`
  Sleep 800
!macroend
