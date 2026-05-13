# Testing Dashboard (/test)

The `/test` route serves as the central dashboard and testing environment for the application.

## Purpose
This environment is used to isolate, build, and verify components, layouts, and interactive features before they are integrated into the main application flows.

## What is tested here?
- **UI Components**: Buttons, inputs, modals, cards, etc.
- **Layouts**: Testing nested architectures like the Double-Bezel shell and Kinetic Sidebar.
- **Micro-interactions**: Hover states, cinematic motion choreography, and haptic feedback simulations.
- **Integrations**: Standalone connection tests for APIs or Socket endpoints.

## Adding a New Test
When developing a new complex component:
1. Create a sub-page under `app/test/[component-name]/page.tsx`.
2. Document its purpose and expected behavior.
3. Link it from the main `/test` dashboard for easy access.

*(Keep this document updated as new testing pages and categories are added.)*
