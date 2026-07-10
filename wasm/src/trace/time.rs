use super::TraceError;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ExtraPrecision {
    Reject,
    Truncate,
}

pub(crate) fn days_from_civil(year: i32, month: u8, day: u8) -> i64 {
    let mut year = i64::from(year);
    let month = i64::from(month);
    let day = i64::from(day);

    year -= i64::from(month <= 2);
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_prime = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * month_prime + 2).div_euclid(5) + day - 1;
    let day_of_era =
        year_of_era * 365 + year_of_era.div_euclid(4) - year_of_era.div_euclid(100) + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

pub(crate) fn decimal_fraction_to_units(
    fraction: &str,
    units_per_integer: u64,
    max_digits: usize,
    extra_precision: ExtraPrecision,
) -> Result<u64, TraceError> {
    let retained_len = match extra_precision {
        ExtraPrecision::Reject if fraction.len() > max_digits => {
            return Err(TraceError::TimestampTooPrecise);
        }
        ExtraPrecision::Reject => fraction.len(),
        ExtraPrecision::Truncate => fraction.len().min(max_digits),
    };

    let retained_bytes = &fraction.as_bytes()[..retained_len];
    if retained_bytes.is_empty() || !retained_bytes.iter().all(u8::is_ascii_digit) {
        return Err(TraceError::InvalidTimestamp);
    }
    let retained = std::str::from_utf8(retained_bytes).map_err(|_| TraceError::InvalidTimestamp)?;

    let value = retained
        .parse::<u64>()
        .map_err(|_| TraceError::InvalidTimestamp)?;
    let scale = 10_u64
        .checked_pow(u32::try_from(retained.len()).map_err(|_| TraceError::TimestampOverflow)?)
        .ok_or(TraceError::TimestampOverflow)?;
    value
        .checked_mul(units_per_integer)
        .ok_or(TraceError::TimestampOverflow)
        .map(|scaled| scaled / scale)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_civil_days_around_unix_epoch() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(1969, 12, 31), -1);
        assert_eq!(days_from_civil(2026, 4, 28), 20_571);
    }

    #[test]
    fn converts_and_limits_decimal_precision_without_floats() {
        assert_eq!(
            decimal_fraction_to_units("003040", 1_000_000_000, 9, ExtraPrecision::Reject),
            Ok(3_040_000)
        );
        assert_eq!(
            decimal_fraction_to_units("0000000001", 1_000_000_000, 9, ExtraPrecision::Reject),
            Err(TraceError::TimestampTooPrecise)
        );
        assert_eq!(
            decimal_fraction_to_units("6714340249528", 86_400_000, 9, ExtraPrecision::Truncate),
            Ok(58_011_899)
        );
        assert_eq!(
            decimal_fraction_to_units("12345678é", 86_400_000, 9, ExtraPrecision::Truncate),
            Err(TraceError::InvalidTimestamp)
        );
        assert_eq!(
            decimal_fraction_to_units("123456789é", 86_400_000, 9, ExtraPrecision::Truncate),
            decimal_fraction_to_units("123456789", 86_400_000, 9, ExtraPrecision::Truncate)
        );
    }
}
