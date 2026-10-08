# Nayax Marshall SDK access — request ready to send

September 16: Mark confirms hardware is present but disconnected, and asks to obtain SDK access first. No vendor message has been sent. The official pages below do not expose a verified public SDK archive. Nayax describes onboarding through an assigned integration engineer who configures Core/the terminal and sends the SDK in a welcome email.

The initial request can be simple: **“Can you send me the Marshall C SDK for Linux and enable our VPOS Touch for integration testing?”** Nayax calls its onboarding contact an integration engineer; we are not asking Mark to hire an engineer or claiming that an extra paid engagement is required. If sales can provide the package and test configuration directly, use that path.

Expanded reply if the representative needs context:

> Subject: Ten Kings — Marshall Linux SDK and test setup
>
> Hi, we are ready to integrate our existing Nayax VPOS Touch into Ten Kings Vault. Please send the Marshall C SDK for Linux x86_64, including the SDK version, headers/source or supported runtime, Linux sample and build instructions.
>
> Our SER5 runs the kiosk software and controls the selected locker door. We want to begin with one product selected before payment and one door, using an explicitly confirmed no-money test configuration. Later we need multiple selected products in one payment. Please arrange the terminal/Core integration configuration and confirm the correct COM2/Marshall harness for our VPOS Touch (PN R144GUSY01S10) and FTDI CHIPI-X10 connection.
>
> Please also confirm how this flow reports a vend when the locker has no door-open sensor, and how we reconcile an interrupted or uncertain transaction without charging again. Let us know whether you need our account/device details through your secure support channel. Can we get SDK access and test setup today?
>
> Thanks, Mark / Ten Kings

First response needed: actual C SDK package + explicit terminal test setup. A technical contact is useful if questions arise; obtaining an engineer assignment is not a separate Ten Kings prerequisite. Keep credentials/account identifiers in Nayax's secure channel or protected local configuration, not repository files or chat. A card included in a hardware box does not prove a no-charge test mode. Owning the terminal does not prove Marshall backend configuration.

Official sources checked September 16:

- [Get started](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/marshall-get-started)
- [Integration process and welcome email](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/marshall-integration-process)
- [C SDK integration with Linux implementation](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/c-sdk-integration)
- [VPOS Touch COM2 installation](https://devzone.nayax.com/docs/integrate-pos-device/marshall/hw-integration-kit-and-setup/installation-steps)

The customer-service payment adapter remains unavailable until the real package and configured test flow are verified. Generic public snippets are insufficient SDK ABI/runtime authority. Continue controller/appliance work independently while onboarding is pending.
