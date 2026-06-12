const std = @import("std");

pub const ExtraPrecision = enum {
    reject,
    truncate,
};

pub fn daysFromCivil(year_value: i32, month_value: u8, day_value: u8) i64 {
    var year = @as(i64, year_value);
    const month = @as(i64, month_value);
    const day = @as(i64, day_value);

    year -= if (month <= 2) 1 else 0;
    const era = @divFloor(year, 400);
    const year_of_era = year - era * 400;
    const month_prime = month + if (month > 2) @as(i64, -3) else @as(i64, 9);
    const day_of_year = @divFloor(153 * month_prime + 2, 5) + day - 1;
    const day_of_era = year_of_era * 365 + @divFloor(year_of_era, 4) - @divFloor(year_of_era, 100) + day_of_year;
    return era * 146097 + day_of_era - 719468;
}

pub fn decimalFractionToUnits(
    fraction: []const u8,
    units_per_integer: u64,
    max_digits: usize,
    extra_precision: ExtraPrecision,
) !u64 {
    const retained = switch (extra_precision) {
        .reject => retained: {
            if (fraction.len > max_digits) return error.TimestampTooPrecise;
            break :retained fraction;
        },
        .truncate => fraction[0..@min(fraction.len, max_digits)],
    };

    const fraction_value = try std.fmt.parseUnsigned(u64, retained, 10);
    const scale = std.math.pow(u64, 10, retained.len);
    return @divTrunc(try std.math.mul(u64, fraction_value, units_per_integer), scale);
}
