import { expect, test } from "@playwright/test";

/**
 * Regresja trzech usterek, które miały wspólną przyczynę: `dispose(false, true)`
 * kasował materiał RAZEM z siatką, a materiały są współdzielone. Po pierwszej
 * śmierci wroga znikał wspólny materiał cieni (cienie robiły się białe) oraz
 * materiał szablonu ciała (wrogowie robili się szaro-metalowi). Czwarta usterka
 * — cienie zostające po śmierci — brała się z podmiany widoku, która zwalniała
 * sam korzeń i zostawiała osierocony dysk cienia.
 */
test("po serii śmierci cienie i wrogowie zachowują materiały", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 500 });
  await page.goto("/?quality=high", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForFunction(() => (window as any).__ms?.renderer?.scene !== undefined, { timeout: 60000 });
  // Czekamy aż fala faktycznie wstanie — 2.5 s po starcie arena bywa pusta.
  await page.waitForFunction(() => {
    const s = (window as any).__ms.world.store;
    let n = 0;
    for (let i = 0; i < s.count; i++) if (s.alive[i] && s.kind[i] === 2) n++;
    return n > 0;
  }, { timeout: 30000 });

  // Zabijamy wszystko, co żyje, i domagamy się kolejnych fal — dopiero
  // recykling identyfikatorów (id wroga wraca jako id złota) odsłaniał błąd.
  const zabite = await page.evaluate(() => {
    const g = (window as any).__ms;
    const s = g.world.store;
    let n = 0;
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < s.count; i++) {
        if (s.alive[i] && s.kind[i] === 2 /* Kind.Enemy */) {
          g.world.damageEnemy(i, 1e9, false, "physical", 0, 0, 0, true);
          n++;
        }
      }
      g.world.tick(1 / 60);
    }
    return n;
  });
  expect(zabite, "test wymaga żywych wrogów").toBeGreaterThan(0);

  // Mierzymy dopiero po wstaniu KOLEJNEJ fali. Na pustej arenie sprawdzanie
  // materiałów wrogów nie dowodzi niczego — a to właśnie nowi wrogowie,
  // budowani po zwolnieniu poprzednich widoków, wychodzili szarzy.
  //
  // Falę wymuszamy krokami symulacji, nie czekaniem na zegarze. Pętla stała
  // ogranicza `realDt` do 0.25 s, więc przy 1–2 fps czas symulacji płynie
  // kilkakrotnie wolniej niż rzeczywisty i dwunastosekundowy oddech między
  // falami potrafi trwać minutę — test padał wtedy na obciążonej maszynie,
  // mimo że wszystko działało.
  await page.evaluate(() => {
    const w = (window as any).__ms.world;
    for (let i = 0; i < 3000 && w.encounter.remaining < 2; i++) w.tick(1 / 60);
  });
  // Widoki powstają w `sync()`, czyli dopiero przy rysowaniu — stąd klatki.
  await page.evaluate(() => new Promise<void>((res) => {
    let n = 0;
    const tick = () => (++n >= 3 ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }));

  // Chód: puszczamy postać w marsz i zbieramy **maksymalne** rozwarcie nóg
  // w serii klatek. Pomiar w jednej chwili jest chwiejny — wymach jest
  // sinusoidą, więc co pół cyklu przechodzi przez zero także wtedy, gdy
  // animacja działa bez zarzutu.
  await page.keyboard.down("d");
  const wymachGracza = await page.evaluate(() => new Promise<number>((res) => {
    const r = (window as any).__ms.renderer;
    let n = 0;
    let max = 0;
    const tick = () => {
      const p = [...r.views.values()].find((v: any) => v.kind === 1) as any;
      if (p?.legL) max = Math.max(max, Math.abs(p.legL.rotation.x - p.legR.rotation.x));
      if (++n >= 40) res(+max.toFixed(3));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));

  const stan = await page.evaluate(() => {
    const g = (window as any).__ms;
    const r = g.renderer as any;
    const scene = r.scene;
    const blob = r.blobMat;

    // Osierocone cienie: dyski „blob" na scenie bez widoku, który je trzyma.
    const blobyNaScenie = scene.meshes.filter((m: any) => m.name.startsWith("blob")).length;
    const blobyWWidokach = [...r.views.values()].filter((v: any) => v.blob).length;

    // Materiał ciała wroga — instancja musi wskazywać żywy materiał szablonu,
    // nie domyślny (biały) materiał Babylona po skasowaniu współdzielonego.
    const wrogowie = [...r.views.values()].filter((v: any) => v.kind === 2 && v.torso);
    const cialaSzare = wrogowie.filter((v: any) => {
      // Materiał skasowany znika z `scene.materials` — to jedyny pewny test,
      // bo `Material` nie wystawia `isDisposed()`.
      const mat = v.torso.sourceMesh?.material;
      const sub = mat?.subMaterials ?? [mat];
      return sub.some((m: any) => !m || !scene.materials.includes(m));
    }).length;

    return {
      cienCzarny: blob ? blob.diffuseColor.r + blob.diffuseColor.g + blob.diffuseColor.b : -1,
      cienZywy: blob ? scene.materials.includes(blob) : false,
      blobyNaScenie,
      blobyWWidokach,
      wrogowie: wrogowie.length,
      cialaSzare,
      // Nogi: każda postać ma dwie instancje podpięte pod korzeń,
      // a idący gracz musi mieć je wychylone w przeciwne strony.
      bezNog: [...r.views.values()].filter((v: any) => v.torso && (!v.legL || !v.legR)).length,
    };
  });

  console.log("STAN:", JSON.stringify({ ...stan, wymachGracza }));
  expect(stan.cienZywy, "wspólny materiał cieni został skasowany").toBe(true);
  expect(stan.cienCzarny, "cienie zrobiły się jasne").toBe(0);
  expect(stan.blobyNaScenie, "osierocone cienie zostały na arenie").toBe(stan.blobyWWidokach);
  expect(stan.cialaSzare, "wrogowie stracili materiał ciała").toBe(0);
  expect(stan.wrogowie, "nowa fala nie wstała — pomiar materiałów byłby pusty").toBeGreaterThan(1);
  expect(stan.bezNog, "postać bez nóg do animacji").toBe(0);
  expect(wymachGracza, "nogi gracza stoją w miejscu podczas marszu").toBeGreaterThan(0.15);
});

/** Krew ma być zielona i widoczna — kubełki kolorów muszą mieć instancje. */
test("krew tryska i ma kolor", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 500 });
  await page.goto("/?quality=high", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForFunction(() => (window as any).__ms?.renderer?.scene !== undefined, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { (document.getElementById("ui") as HTMLElement).style.display = "none"; });

  await page.evaluate(() => {
    const g = (window as any).__ms, r = g.renderer, s = g.world.store, p = g.world.player;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      r.spawnHitFx(s.x[p] + Math.cos(a) * 1.3, s.y[p] + Math.sin(a) * 1.3, a, i % 3 === 0, 1.4);
    }
  });

  // Czekamy na KLATKI, nie na milisekundy. Przy 5 fps w rasteryzacji
  // programowej 90 ms to bywa zero klatek — pomiar łapie wtedy stan sprzed
  // przetworzenia cząstek i niczego nie dowodzi.
  await page.evaluate(() => new Promise<void>((res) => {
    let n = 0;
    const tick = () => (++n >= 2 ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }));

  // Sedno regresji: kubełki kolorów muszą **nieść** żywe cząstki. Zepsuta
  // wersja miała komplet kubełków z zerem instancji — cząstki żyły w tablicy,
  // ale nic ich nie rysowało. Liczby bezwzględnej nie sprawdzamy: zależy od
  // tego, ile klatek zdążyło minąć, więc byłaby chwiejna.
  const p = await page.evaluate(() => {
    const parts = ((window as any).__ms.renderer as any).particles;
    const kubelki = [...parts.buckets.values()] as any[];
    return {
      zywe: parts.activeCount,
      wKubelkach: kubelki.reduce((a, b) => a + b.count, 0),
      kolory: kubelki.filter((b) => b.count > 0).length,
    };
  });
  expect(p.zywe, "cząstki krwi nie dożyły klatki").toBeGreaterThan(0);
  expect(p.wKubelkach, "cząstki żyją, ale żaden kubełek ich nie rysuje").toBe(p.zywe);
  expect(p.kolory, "krew rysowana bez podziału na kolory").toBeGreaterThan(1);
  if (process.env.PW_TOOLS === "true") {
    await page.screenshot({ path: "tests/artifacts/krew.png" });
  }
});
