{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay.url = "github:oxalica/rust-overlay";
    rust-overlay.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    rust-overlay,
  }:
    flake-utils.lib.eachDefaultSystem (
      system: let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [(import rust-overlay)];
        };
        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          targets = ["wasm32-unknown-unknown"];
          extensions = ["rust-src" "rustfmt" "clippy" "rust-analyzer"];
        };
      in {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.pnpm
            rustToolchain
            pkgs.wasm-bindgen-cli
            pkgs.binaryen
          ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
            pkgs.xvfb-run
          ];
        };
      }
    );
}
