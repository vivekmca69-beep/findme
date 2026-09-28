# FindMe V9 — Action Loading & Duplicate-Tap Protection

This update adds explicit busy feedback to asynchronous user actions.

## What changed

- Save vehicle, find vehicle, clear vehicle: spinner + duplicate-tap guard.
- Create group and join group: spinner + form/button lock until completion.
- End/leave session: spinner + duplicate-tap guard.
- Smart meeting point: spinner while publishing the point.
- Navigate to host / meeting point: spinner while the first route is being calculated.
- Compass actions: spinner while orientation permission/setup is in progress.
- Map status pill shows a spinner while an action or route calculation is running.
- Route-mode buttons are temporarily disabled while a route calculation is already in progress.

Immediate local-only controls such as map/satellite switch, full screen, recenter, and stop navigation remain instant and do not show a spinner.

The implementation uses a Set of action keys in `AppComponent`, so a second click on the same asynchronous action is ignored until the first request completes or fails.
