use super::{Dbc, DbcError};

/// Owned parsed DBC kept alive by the WebAssembly-facing class.
///
/// Dropping the handle releases the parsed model and its owned strings.
#[derive(Debug)]
pub struct Handle {
    pub dbc: Dbc,
}

impl Handle {
    pub fn parse(input: &str) -> Result<Self, DbcError> {
        Ok(Self {
            dbc: Dbc::parse(input)?,
        })
    }

    pub fn to_catalog_json(&self) -> String {
        self.dbc.to_catalog_json()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owns_parsed_dbc_source_data() {
        let input =
            String::from("BO_ 100 Example: 8 ECU\n SG_ State : 0|8@1+ (1,0) [0|255] \"\" DASH");
        let handle = Handle::parse(&input).unwrap();
        drop(input);

        assert_eq!(handle.dbc.messages.len(), 1);
        assert_eq!(handle.dbc.messages[0].name, "Example");
    }
}
