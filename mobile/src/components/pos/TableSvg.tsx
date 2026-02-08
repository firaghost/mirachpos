import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { SvgUri } from 'react-native-svg'
import { Asset } from 'expo-asset'

export function TableSvg({ size = 72 }: { size?: number }) {
  const [uri, setUri] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const asset = Asset.fromModule(require('../../../assets/Table/Table.svg'))
        await asset.downloadAsync()
        if (mounted) setUri(asset.localUri || asset.uri)
      } catch {}
    })()
    return () => { mounted = false }
  }, [])

  if (!uri) return <View style={{ width: size, height: size }} />
  return <SvgUri uri={uri} width={size} height={size} />
}

export default TableSvg
