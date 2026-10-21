# Windows signing configuration

The `windows-signing` artifact configuration signs the app first, then the NSIS
and MSI installers. All signed PE files (including the app inside the MSI) must
have `ProductName=TikZ Editor` and the same `ProductVersion`. The composite action
reads that version from `tauri.conf.json`, verifies the built app metadata, and
passes it to both signing requests as the required `version` parameter.

SignPath currently supports `subject` and `author` restrictions on MSI containers,
not the PE-specific `product-name` and `product-version` attributes. Keep the
existing MSI restrictions and the restrictions on its nested application.

## Activating the revised configuration

1. Integrate the XML and composite-action changes together. Do not update the
   deployed configuration while intending to run the older, parameter-less action.
2. In SignPath, update project `tikz-editor`'s artifact configuration
   `windows-signing` with `artifact-configuration.xml`. A repository commit does
   not update SignPath's stored XML automatically.
3. Run the test-signing workflow on the updated branch and confirm both requests
   show the same version parameter and complete successfully. Do not publish
   artifacts signed with the self-signed test certificate.
4. Restrict the production `release-signing` policy to `master`, keeping trusted
   build verification, origin verification, and manual approval enabled.
5. Request SignPath's setup review and production certificate issuance once the
   test-signing integration and public code-signing policy are ready.

References:
- https://docs.signpath.io/artifact-configuration/examples
- https://docs.signpath.io/artifact-configuration/reference#file-metadata-restrictions
- https://docs.signpath.io/trusted-build-systems/github
