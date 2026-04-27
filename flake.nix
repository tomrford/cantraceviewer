{
  inputs = {
    # Non-strict version packages come from here
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

    # Utility for building this flake
    flake-utils.url = "github:numtide/flake-utils";

    # Overlay for bringing in the zig compiler for the simulation DLL
    zig-overlay.url = "github:mitchellh/zig-overlay";
    zig-overlay.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    zig-overlay,
  }:
    flake-utils.lib.eachDefaultSystem (
      system: let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [zig-overlay.overlays.default];
        };
      in {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.bun
            pkgs.zigpkgs."0.16.0"
          ];
        };
      }
    );
}
