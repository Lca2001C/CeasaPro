/**
 * Créditos das fotos do Banco de fotos (`catalogo_imagens`) que vieram do
 * Wikimedia Commons. A maioria é CC BY / CC BY-SA / GFDL, que exigem citar o
 * autor e a licença onde a foto é usada — é o que `/creditos-fotos` mostra.
 *
 * Foto nova do Commons no Banco entra aqui também. `autor: null` quando o
 * arquivo não declara autor: o crédito fica sendo o link da página do arquivo.
 */

export interface CreditoDeFoto {
  produto: string;
  autor: string | null;
  licenca: string;
  /** Página do arquivo no Wikimedia Commons (autor, licença completa, original). */
  origem: string;
}

export const CREDITOS_DO_BANCO: readonly CreditoDeFoto[] = [
  { produto: "Abacate", autor: "Ivar Leidus", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Avocado_Hass_-_single_and_halved.jpg" },
  { produto: "Abacaxi", autor: "Deise Garrido", licenca: "CC BY-SA 2.0", origem: "https://commons.wikimedia.org/wiki/File:Ananas!.jpg" },
  { produto: "Abóbora", autor: "Martin Doege (Morn)", licenca: "GFDL 1.2", origem: "https://commons.wikimedia.org/wiki/File:Pumpkins.jpg" },
  { produto: "Abobrinha", autor: "Rasbak", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Courgette_Cucurbita_pepo.jpg" },
  { produto: "Acelga", autor: null, licenca: "Public domain", origem: "https://commons.wikimedia.org/wiki/File:Swiss_Chard.jpg" },
  { produto: "Acerola", autor: "Veronidae", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Malpighia_emarginata_2013_000.JPG" },
  { produto: "Agrião", autor: null, licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Nasturtium_lvs.jpg" },
  { produto: "Alface", autor: "en:User:Geographer", licenca: "CC BY 1.0", origem: "https://commons.wikimedia.org/wiki/File:Iceberg_lettuce_in_SB.jpg" },
  { produto: "Alho", autor: "Donovan Govan.", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Garlic.jpg" },
  { produto: "Alho-poró", autor: "Biso", licenca: "Public domain", origem: "https://commons.wikimedia.org/wiki/File:Leeks_bg.JPG" },
  { produto: "Ameixa", autor: "Ivar Leidus", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Plums_African_Rose_-_whole,_halved_and_slice.jpg" },
  { produto: "Amendoim", autor: "Sanjay Acharya", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Roasted_Peanuts_with_shell.jpg" },
  { produto: "Banana", autor: "Alabama Extension", licenca: "CC0", origem: "https://commons.wikimedia.org/wiki/File:Bananas_(Alabama_Extension).jpg" },
  { produto: "Batata", autor: "WOtP", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Batata.JPG" },
  { produto: "Batata-doce", autor: "Bageense", licenca: "CC BY 4.0", origem: "https://commons.wikimedia.org/wiki/File:Batata-doce,_ou_jetica_(do_tupi_%C3%AEetyka).jpg" },
  { produto: "Berinjela", autor: "Joydeep", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Solanum_melongena_24_08_2012_(1).JPG" },
  { produto: "Beterraba", autor: "Evan-Amos", licenca: "CC0", origem: "https://commons.wikimedia.org/wiki/File:Beets-Bundle.jpg" },
  { produto: "Brócolis", autor: "Fir0002", licenca: "GFDL 1.2", origem: "https://commons.wikimedia.org/wiki/File:Broccoli_and_cross_section_edit.jpg" },
  { produto: "Caju", autor: "வெங்கட்ராமன். தி", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Cashew_fruit_apple.jpg" },
  { produto: "Caqui", autor: "Olegivvit", licenca: "CC BY-SA 2.5", origem: "https://commons.wikimedia.org/wiki/File:Persimmon-oliv1.jpg" },
  { produto: "Cará", autor: null, licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:YamsatBrixtonMarket.jpg" },
  { produto: "Carambola", autor: null, licenca: "Public domain", origem: "https://commons.wikimedia.org/wiki/File:Averrhoa_carambola_ARS_k5735-7.jpg" },
  { produto: "Cebola", autor: "OsvaldoGago", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Onion_2.JPG" },
  { produto: "Cebolinha", autor: "Deans Charbal", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Fresh_scallions_from_Gorzynski_Ornery_Farm,_Union_Square_Greenmarket,_May_17_2025,_Manhattan,_New_York.jpg" },
  { produto: "Cenoura", autor: "Aastha12gogo", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Carrots_001.jpg" },
  { produto: "Chuchu", autor: "Prathyush Thomas", licenca: "GFDL 1.2", origem: "https://commons.wikimedia.org/wiki/File:Chayote_cross_section_BNC.jpg" },
  { produto: "Coco verde", autor: "Crisco 1492", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Coconut_Drink,_Pangandaran.JPG" },
  { produto: "Coentro", autor: "Kpsudeep", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Bunches_of_coriander_leaves.jpg" },
  { produto: "Cogumelo", autor: "chris_73", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:ChampignonMushroom.jpg" },
  { produto: "Couve", autor: "Evan-Amos", licenca: "Public domain", origem: "https://commons.wikimedia.org/wiki/File:Collard-Greens-Bundle.jpg" },
  { produto: "Couve-flor", autor: "Rasbak", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Bloemkool.jpg" },
  { produto: "Cupuaçu", autor: "Pedro Spoladore", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Cupua%C3%A7u.JPG" },
  { produto: "Ervilha", autor: "Fumikas Sagisavas", licenca: "CC0", origem: "https://commons.wikimedia.org/wiki/File:Green_pea_pods.jpg" },
  { produto: "Espinafre", autor: "Charipearl", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Fresh_Spinach_leaves.jpg" },
  { produto: "Feijão-vagem", autor: "Jeffery Martin", licenca: "CC0", origem: "https://commons.wikimedia.org/wiki/File:Green_beans_in_a_pile.JPG" },
  { produto: "Figo", autor: "BenAveling", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Bowl_of_Figs.jpg" },
  { produto: "Gengibre", autor: "Mk2010", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Ginger_rhizome.jpg" },
  { produto: "Goiaba", autor: "Rodrigo.Argenton", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Goiaba_vermelha.jpg" },
  { produto: "Graviola", autor: "USGov", licenca: "Public domain", origem: "https://commons.wikimedia.org/wiki/File:Soursop_fruit.jpg" },
  { produto: "Hortelã", autor: "HaJunkiyada", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Liat_Portal_for_Foodie_Disorder_-_Fresh_Mint_from_San_Francisco_Farmers_Market.jpg" },
  { produto: "Inhame", autor: "varintorn", licenca: "CC0", origem: "https://commons.wikimedia.org/wiki/File:Colocasia_esculenta_var._esculenta-1686669.jpg" },
  { produto: "Jabuticaba", autor: "Bageense", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Jabuticaba_(do_tupi_%C3%AEabotikaba,_%27gordura_de_jabuti%27)_07.jpg" },
  { produto: "Jiló", autor: "Junius", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Fruta_Jil%C3%B3.JPG" },
  { produto: "Kiwi", autor: "Luc Viatour", licenca: "CC BY-SA 2.5", origem: "https://commons.wikimedia.org/wiki/File:Kiwi_(Actinidia_chinensis)_1_Luc_Viatour.jpg" },
  { produto: "Laranja", autor: "Ivar Leidus", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Oranges_-_whole-halved-segment.jpg" },
  { produto: "Lichia", autor: "Barry Fitzgerald, USDA", licenca: "Public domain", origem: "https://commons.wikimedia.org/wiki/File:Lychee.jpg" },
  { produto: "Limão", autor: "Ivar Leidus", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Lemon_-_whole_and_split.jpg" },
  { produto: "Maçã", autor: "Abhijit Tembhekar from Mumbai, India", licenca: "CC BY 2.0", origem: "https://commons.wikimedia.org/wiki/File:Red_Apple.jpg" },
  { produto: "Mamão", autor: "OKJaguar", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Papaya_half.jpg" },
  { produto: "Mandioca", autor: "Emőke Dénes", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Malpighiales_-_Manihot_esculenta_-_2.jpg" },
  { produto: "Mandioquinha", autor: "Germarquezm", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Arracacia_xanthorrhiza_supermarket.jpg" },
  { produto: "Manga", autor: "Ivar Leidus", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Mangos_-_single_and_halved.jpg" },
  { produto: "Manjericão", autor: "Castielli", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Basil-Basilico-Ocimum_basilicum-albahaca.jpg" },
  { produto: "Maracujá", autor: "Rodrigo.Argenton", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Maracuj%C3%A1_em_fundo_preto_(2).JPG" },
  { produto: "Maxixe", autor: "Filo gèn'", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Cucumis_anguria,_Fruits_03.jpg" },
  { produto: "Melancia", autor: "Jack Keene from Oak Cliff, Texas, USA", licenca: "CC BY 2.0", origem: "https://commons.wikimedia.org/wiki/File:Summer_99.jpg" },
  { produto: "Melão", autor: "Yotoen", licenca: "Public domain", origem: "https://commons.wikimedia.org/wiki/File:Honeydew.jpg" },
  { produto: "Mexerica", autor: "Joe Ravi", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Mandarin_Oranges_(Citrus_Reticulata).jpg" },
  { produto: "Milho verde", autor: "Daderot", licenca: "CC0", origem: "https://commons.wikimedia.org/wiki/File:Corn_on_the_cob_-_Massachusetts.jpg" },
  { produto: "Morango", autor: null, licenca: "CC BY-SA 2.0", origem: "https://commons.wikimedia.org/wiki/File:Strawberries.JPG" },
  { produto: "Nabo", autor: "Peter Presslein", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Brassica_rapa_turnip.jpg" },
  { produto: "Nectarina", autor: "Fir0002", licenca: "GFDL 1.2", origem: "https://commons.wikimedia.org/wiki/File:White_nectarine_and_cross_section.jpg" },
  { produto: "Ovo", autor: "Evan-Amos", licenca: "Public domain", origem: "https://commons.wikimedia.org/wiki/File:6-Pack-Chicken-Eggs.jpg" },
  { produto: "Pepino", autor: "Stephen Ausmus, USDA ARS", licenca: "Public domain", origem: "https://commons.wikimedia.org/wiki/File:ARS_cucumber.jpg" },
  { produto: "Pera", autor: "Keith Weller", licenca: "Public domain", origem: "https://commons.wikimedia.org/wiki/File:Pears.jpg" },
  { produto: "Pêssego", autor: "Peachyeung316", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Australasian_peaches_in_the_fruit_shop_at_North_Point.jpg" },
  { produto: "Pimenta", autor: "David Monniaux", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Peppers_dsc07818.jpg" },
  { produto: "Pimentão", autor: null, licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Capsicum1.jpg" },
  { produto: "Pinha", autor: "Muhammad Mahdi Karim", licenca: "GFDL 1.2", origem: "https://commons.wikimedia.org/wiki/File:Sugar_apple_on_tree.jpg" },
  { produto: "Pitaya", autor: "Webysther Nunes", licenca: "CC BY-SA 4.0", origem: "https://commons.wikimedia.org/wiki/File:Webysther_20150409032418_-_Pitaya.jpg" },
  { produto: "Quiabo", autor: "Earth100", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Hong_Kong_Okra_Aug_25_2012.JPG" },
  { produto: "Rabanete", autor: null, licenca: "Public domain", origem: "https://commons.wikimedia.org/wiki/File:Raphanus_sativus.jpg" },
  { produto: "Repolho", autor: "Bill Tarpenning", licenca: "Public domain", origem: "https://commons.wikimedia.org/wiki/File:Cabbage.jpg" },
  { produto: "Romã", autor: "Fir0002", licenca: "GFDL 1.2", origem: "https://commons.wikimedia.org/wiki/File:Pomegranate.jpg" },
  { produto: "Rúcula", autor: "Leo Michels", licenca: "Public domain", origem: "https://commons.wikimedia.org/wiki/File:Eruca_sativa_1_IP0206101.jpg" },
  { produto: "Salsa", autor: "Forest &amp; Kim Starr", licenca: "CC BY 3.0", origem: "https://commons.wikimedia.org/wiki/File:Starr_020911-9003_Petroselinum_crispum.jpg" },
  { produto: "Tangerina", autor: "Joe Ravi", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Mandarin_Oranges_(Citrus_Reticulata).jpg" },
  { produto: "Tomate", autor: null, licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Tomatoes-on-the-bush.jpg" },
  { produto: "Uva", autor: "T.o.m.~commonswiki", licenca: "CC BY-SA 3.0", origem: "https://commons.wikimedia.org/wiki/File:Riesling_grapes_leaves.jpg" },
];
