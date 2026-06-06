{
  inputs = {
    # Non-strict version packages come from here
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

    # Utility for building this flake
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem (
      system: let
        pkgs = import nixpkgs {
          inherit system;
        };
      in {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.bun
            pkgs.zig_0_16
            pkgs.zls_0_16
          ];
        };
      }
    );
}
