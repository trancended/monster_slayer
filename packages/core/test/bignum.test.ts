/**
 * Testy reprezentacji wielkich liczb. To jest fundament, na którym stoi cała
 * ekonomia idle — błąd tutaj objawia się jako „złoto stanęło" po dwóch dniach
 * gry i jest wtedy nie do wyśledzenia. Stąd gęstość przypadków brzegowych.
 *
 * Uruchomienie: `node --test packages/core/test/` (Node 25 stripuje typy sam).
 */
import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import {
  add,
  BIG_ONE,
  BIG_ZERO,
  big,
  bigFromJSON,
  bigParse,
  bigToJSON,
  cmp,
  div,
  format,
  formatCount,
  formatDuration,
  gte,
  log10,
  lt,
  mul,
  pow,
  powNum,
  scale,
  sqrt,
  sub,
  sum,
  THOUSANDS_SEPARATOR,
  toNumber,
} from "../src/core/bignum.ts";

/** Porównanie względne — mantysa float64 nie jest dokładna do ostatniego bitu. */
function close(a: number, b: number, rel = 1e-9): void {
  if (a === b) return;
  const scaleRef = Math.max(Math.abs(a), Math.abs(b));
  assert.ok(
    Math.abs(a - b) <= rel * scaleRef,
    `oczekiwano ≈${b}, otrzymano ${a} (błąd względny ${Math.abs(a - b) / scaleRef})`,
  );
}

describe("normalizacja", () => {
  test("mantysa zawsze w [1, 10)", () => {
    const cases = [1, 9.999, 10, 99.9, 1e15, 1.5e-7, 123456789, 0.000123];
    for (const v of cases) {
      const b = big(v);
      assert.ok(Math.abs(b.m) >= 1 && Math.abs(b.m) < 10, `${v} → m=${b.m}`);
      close(toNumber(b), v);
    }
  });

  test("zero i wartości niepoprawne schodzą do BIG_ZERO", () => {
    for (const v of [0, NaN, Infinity, -Infinity]) {
      assert.deepEqual(big(v), BIG_ZERO);
    }
  });

  test("granica dekady nie gubi rzędu wielkości", () => {
    // log10(1000) potrafi wyjść 2.9999999996 — bez korekty mantysa wypada z zakresu.
    for (let e = 0; e <= 40; e++) {
      const b = big(1, e);
      assert.equal(b.e, e, `10^${e} → e=${b.e}`);
      close(b.m, 1);
    }
  });

  test("liczby ujemne zachowują znak", () => {
    const b = big(-2500);
    assert.ok(b.m < 0);
    close(toNumber(b), -2500);
  });
});

describe("arytmetyka", () => {
  test("dodawanie zgadza się ze zwykłym number w bezpiecznym zakresie", () => {
    close(toNumber(add(big(1234), big(56.78))), 1290.78);
    close(toNumber(add(big(1e12), big(1e12))), 2e12);
  });

  test("dodawanie składnika mniejszego o 20 rzędów jest no-opem", () => {
    const a = big(1, 40);
    assert.deepEqual(add(a, big(1)), a);
  });

  test("odejmowanie do zera i poniżej", () => {
    assert.equal(cmp(sub(big(5), big(5)), BIG_ZERO), 0);
    assert.ok(lt(sub(big(5), big(8)), BIG_ZERO));
  });

  test("mnożenie przekracza MAX_SAFE_INTEGER bez utraty wykładnika", () => {
    const huge = mul(big(1, 200), big(1, 200));
    assert.equal(huge.e, 400);
    close(huge.m, 1);
  });

  test("dzielenie przez zero zwraca zero zamiast NaN", () => {
    assert.deepEqual(div(big(10), BIG_ZERO), BIG_ZERO);
  });

  test("scale to skrót na mnożenie przez number", () => {
    close(toNumber(scale(big(1, 30), 2.5)), 2.5e30);
    assert.deepEqual(scale(big(5), 0), BIG_ZERO);
  });

  test("suma tablicy", () => {
    close(toNumber(sum([big(1), big(2), big(3)])), 6);
    assert.deepEqual(sum([]), BIG_ZERO);
  });
});

describe("potęgi i logarytmy — rdzeń krzywych kosztów", () => {
  test("powNum odtwarza Math.pow w bezpiecznym zakresie", () => {
    for (const [base, k] of [
      [1.09, 10],
      [1.12, 50],
      [1.16, 30],
      [2, 20],
    ] as const) {
      close(toNumber(powNum(base, k)), Math.pow(base, k), 1e-9);
    }
  });

  test("powNum nie przepełnia się przy wykładniku, na którym number pada", () => {
    // 1.16^500 ≈ 1e33 mieści się w number, ale 1.16^5000 już nie.
    const b = powNum(1.16, 5000);
    assert.ok(Number.isFinite(b.e) && b.e > 300, `e=${b.e}`);
    close(log10(b), Math.log10(1.16) * 5000, 1e-12);
  });

  test("pow zachowuje znak dla całkowitych wykładników", () => {
    close(toNumber(pow(big(-2), 3)), -8);
    close(toNumber(pow(big(-2), 2)), 4);
  });

  test("sqrt jest odwrotnością kwadratu — używane we wzorze na PP", () => {
    const v = big(4, 24); // 4e24
    close(toNumber(mul(sqrt(v), sqrt(v))), 4e24, 1e-9);
  });

  test("log10 zera to -Infinity, nie NaN", () => {
    assert.equal(log10(BIG_ZERO), -Infinity);
  });
});

describe("porównania", () => {
  test("porządek zgodny z number", () => {
    const values = [-1e9, -1, 0, 1, 1.5, 1000, 1e15, 1e40];
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < values.length; j++) {
        assert.equal(
          Math.sign(cmp(big(values[i]!), big(values[j]!))),
          Math.sign(values[i]! - values[j]!),
          `cmp(${values[i]}, ${values[j]})`,
        );
      }
    }
  });

  test("gte na równych wartościach", () => {
    assert.ok(gte(big(1e30), big(1e30)));
    assert.ok(gte(BIG_ONE, BIG_ONE));
  });
});

describe("formatowanie", () => {
  test("notacja skrócona używa polskiej skali długiej", () => {
    assert.equal(format(big(2.4e6)), "2.4 mln");
    assert.equal(format(big(1.5e9)), "1.5 mld");
    assert.equal(format(big(3e12)), "3 bln");
    assert.equal(format(big(1.24e15)), "1.24 bld");
  });

  test("poniżej tysiąca bez jednostki", () => {
    assert.equal(format(big(0)), "0");
    assert.equal(format(big(42)), "42");
    assert.equal(format(big(999)), "999");
  });

  test("poza tablicą jednostek schodzimy do notacji naukowej", () => {
    const s = format(big(1, 90));
    assert.match(s, /e90$/);
  });

  test("notacja naukowa i inżynierska", () => {
    assert.equal(format(big(1.24e15), { notation: "scientific" }), "1.24e15");
    assert.match(format(big(1.24e16), { notation: "engineering" }), /e15$/);
  });

  test("formatCount grupuje tysiące spacją niełamliwą", () => {
    // Separator to U+00A0, nie zwykła spacja: `14 302` nie może się złamać
    // na dwie linie w liczniku zabójstw na ekranie powrotu.
    assert.equal(formatCount(14302), `14${THOUSANDS_SEPARATOR}302`);
    assert.equal(formatCount(999), "999");
  });

  test("formatDuration czyta się po polsku", () => {
    assert.equal(formatDuration(38), "38 s");
    assert.equal(formatDuration(27720), "7 h 42 min");
    assert.equal(formatDuration(3600), "1 h");
    assert.equal(formatDuration(90000), "1 d 1 h");
  });
});

describe("serializacja", () => {
  test("round-trip przez JSON zachowuje wartość", () => {
    for (const v of [0, 1, -1, 1234.5678, 1e15]) {
      const b = big(v);
      assert.equal(cmp(bigFromJSON(bigToJSON(b)), b), 0, `v=${v}`);
    }
    const huge = big(6.02, 223);
    assert.equal(cmp(bigFromJSON(bigToJSON(huge)), huge), 0);
  });

  test("odczyt starych zapisów, w których pole było zwykłym number", () => {
    assert.equal(cmp(bigFromJSON(2500), big(2500)), 0);
  });

  test("uszkodzone wejście daje zero, nie wyjątek", () => {
    for (const bad of [undefined, null, {}, "", "abc", "1|", "|5", [1, 2]]) {
      assert.doesNotThrow(() => bigFromJSON(bad));
    }
  });

  test("bigParse czyta to, co gracz może wpisać", () => {
    close(toNumber(bigParse("12500")), 12500);
    close(toNumber(bigParse("1.2e9")), 1.2e9);
    close(toNumber(bigParse("3 mln")), 3e6);
    close(toNumber(bigParse("2,5 mld")), 2.5e9);
    assert.deepEqual(bigParse(""), BIG_ZERO);
    assert.deepEqual(bigParse("nonsens"), BIG_ZERO);
  });
});
