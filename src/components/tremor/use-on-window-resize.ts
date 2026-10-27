// Tremor useOnWindowResize hook — copied from Tremor.
// License: Apache 2.0 (Tremor).

import * as React from "react"

export const useOnWindowResize = (handler: () => void) => {
  React.useEffect(() => {
    const handleResize = () => {
      handler()
    }
    handleResize()
    window.addEventListener("resize", handleResize)

    return () => window.removeEventListener("resize", handleResize)
  }, [handler])
}
