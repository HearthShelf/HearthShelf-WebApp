/**
 * Local, per-BROWSER (not per-account) preferences about this device, distinct
 * from rememberedAccounts (which is the roster of accounts). Right now this is
 * just "have we already asked whether this is a shared screen", so a car/family
 * tablet only gets asked once rather than on every sign-in.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DeviceSettingsState {
  /** Whether the shared-device prompt has been shown (and answered) already. */
  askedSharedDevice: boolean
  markAskedSharedDevice: () => void
}

export const useDeviceSettings = create<DeviceSettingsState>()(
  persist(
    (set) => ({
      askedSharedDevice: false,
      markAskedSharedDevice: () => set({ askedSharedDevice: true }),
    }),
    { name: 'hearthshelf:device-settings' },
  ),
)
