export const PET_LOCK_SHORTCUT = "Tab+0";

export type PetLockShortcutRegistration = {
  accelerator: string;
  registered: boolean;
  reason: "registered" | "already_registered" | "unavailable";
};

export type PetLockShortcutController = {
  register(): PetLockShortcutRegistration;
  unregister(): void;
  isRegistered(): boolean;
};

export function createPetLockShortcut(options: {
  accelerator?: string;
  register: (accelerator: string, callback: () => void) => boolean;
  unregister: (accelerator: string) => void;
  isRegistered?: (accelerator: string) => boolean;
  onTriggered: () => void;
}): PetLockShortcutController {
  const accelerator = options.accelerator ?? PET_LOCK_SHORTCUT;
  let registeredByController = false;

  function isRegistered(): boolean {
    return registeredByController || Boolean(options.isRegistered?.(accelerator));
  }

  return {
    register() {
      if (isRegistered()) {
        return {
          accelerator,
          registered: true,
          reason: "already_registered"
        };
      }

      registeredByController = options.register(accelerator, options.onTriggered);

      return {
        accelerator,
        registered: registeredByController,
        reason: registeredByController ? "registered" : "unavailable"
      };
    },
    unregister() {
      if (!registeredByController) {
        return;
      }

      options.unregister(accelerator);
      registeredByController = false;
    },
    isRegistered
  };
}
