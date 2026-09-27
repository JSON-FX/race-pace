"use client"

import { useRef } from "react"

// Table actions and asynchronous upload pickers open modals without a Radix
// trigger. Remember their opener while retaining consumer autofocus handlers.
export function useModalFocus(onOpen?: (event: Event) => void, onClose?: (event: Event) => void) {
  const opener = useRef<HTMLElement | null>(null)
  return {
    onOpenAutoFocus(event: Event) {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      // A menu item unmounts as its dialog opens. Restore the persistent menu
      // trigger instead; Radix connects the menu to it with aria-labelledby.
      const triggerId = active?.closest('[role="menu"]')?.getAttribute("aria-labelledby")
      opener.current = (triggerId ? document.getElementById(triggerId) : null) ?? active
      onOpen?.(event)
    },
    onCloseAutoFocus(event: Event) {
      onClose?.(event)
      if (!event.defaultPrevented && opener.current?.isConnected) {
        event.preventDefault()
        opener.current.focus()
      }
    },
  }
}
