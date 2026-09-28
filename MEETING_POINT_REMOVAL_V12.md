# FindMe V12 - Meeting point feature removal

Removed from the user interface:

- Smart meeting point
- Navigate to meeting point
- Compass to meeting point
- Group meeting point status card
- Meeting-point marker from the map

Host navigation, host compass, participant tracking, Google Maps, Google Routes, parking, Redis persistence and group road routes are unchanged.

The backend meeting-point fields/methods remain in place for session-schema compatibility, but the frontend no longer exposes or renders the feature.
