import { classifyDevice, type ABSDeviceInfo, type DeviceKind } from '@hearthshelf/core'
import { Icon } from './Icon'

// Simple monochrome brand/surface glyphs for a listening session's origin.
// Material Symbols has no Apple/Android logos, so Apple/Android/Car are inline
// SVGs (currentColor) while web/desktop reuse the Material Symbols font.
const PATHS: Partial<Record<DeviceKind, string>> = {
  // Apple logo.
  apple:
    'M16.365 1.43c0 1.14-.417 2.2-1.11 2.98-.84.94-2.2 1.66-3.28 1.58-.14-1.1.42-2.27 1.06-3 .72-.82 2.02-1.44 3.13-1.5.02.32.05.62.1.94zM20.5 17.06c-.55 1.27-.82 1.84-1.53 2.96-.99 1.57-2.39 3.52-4.12 3.53-1.54.02-1.94-1-4.03-.99-2.09.01-2.53 1.01-4.07.99-1.73-.02-3.05-1.79-4.04-3.35C-.06 15.96-.35 10.94 1.36 8.27 2.57 6.38 4.5 5.28 6.31 5.28c1.85 0 3.01 1.01 4.54 1.01 1.48 0 2.38-1.01 4.52-1.01 1.61 0 3.32.88 4.54 2.39-3.99 2.18-3.34 7.88.59 9.4z',
  // Android robot head.
  android:
    'M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48C13.85 1.23 12.95 1 12 1c-.96 0-1.86.23-2.66.63L7.85.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31C6.97 3.26 6 5.01 6 7h12c0-1.99-.97-3.75-2.44-4.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z',
  // Car (Material's directions_car body).
  car: 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
}

/** Brand/surface icon for a listening session's origin (Apple/Android/Car/Web). */
export function DeviceKindIcon({
  deviceInfo,
  device,
  size = 15,
  style,
}: {
  deviceInfo: ABSDeviceInfo | undefined
  /** Optional human device string appended to the tooltip. */
  device?: string
  size?: number
  style?: React.CSSProperties
}) {
  const dev = classifyDevice(deviceInfo)
  const title = device ? `${dev.label} - ${device}` : dev.label
  const path = PATHS[dev.kind]
  if (path) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        style={style}
        role="img"
        aria-label={title}
      >
        <title>{title}</title>
        <path d={path} />
      </svg>
    )
  }
  // web / desktop: Material Symbols font glyph.
  return (
    <Icon
      name={dev.kind === 'web' ? 'language' : 'computer'}
      title={title}
      style={{ fontSize: size, ...style }}
    />
  )
}
