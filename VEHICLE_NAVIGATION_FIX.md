# Vehicle navigation fix

This build fixes two issues found during mobile testing:

1. Repeated **Find vehicle** taps no longer create orphaned/duplicate `You` markers. The app now reuses one current-location marker.
2. Vehicle routing is now live. While navigation is active, browser GPS continuously moves the `You` marker and the walking route is recalculated after meaningful movement.

The route is rendered with a white casing plus a blue center line so it remains visible in both Street and Satellite map modes.

The vehicle marker remains fixed at the saved location. Use **Stop navigation** to stop the dedicated vehicle GPS watcher.
