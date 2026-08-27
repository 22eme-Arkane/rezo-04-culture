-- =============================================================================
-- Armana — Migration 0019 : le département de chaque événement, connu en base
-- =============================================================================
-- POURQUOI EN BASE ET PAS SEULEMENT CÔTÉ CLIENT
-- Les modérateurs seront rattachés à des départements : la file de modération,
-- les droits d'approbation et le routage des notifications doivent être
-- cloisonnés PAR LA BASE (invariant du projet : jamais de confiance côté
-- client). Il faut donc que chaque événement porte son département.
--
-- CE QUE FAIT CE FICHIER
--   A. table dept_contours : les six contours, version ALLÉGÉE (~0,8 km de
--      tolérance, 15 Ko) — largement assez précis pour attribuer un
--      département, sans imposer 204 Ko à PostGIS ;
--   B. dept_of_point() : département d'un point, enclave des Papes comprise ;
--   C. events.dept, rempli par trigger + rattrapage de l'existant ;
--   D. la vue events_geo recréée pour exposer la colonne ;
--   E. visites (membres et anonymes) : colonne dept + RPC étendues ;
--   F. admin_stats : passages par département.
--
-- PRÉCISION ASSUMÉE : en bordure de frontière (~800 m), un événement peut être
-- attribué au voisin. Sans conséquence : c'est un routage de modération, pas
-- du cadastre, et le contour COMPLET reste celui affiché sur la carte.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Contours allégés
-- -----------------------------------------------------------------------------
create table if not exists public.dept_contours (
  code text primary key,
  geom geometry(MultiPolygon, 4326) not null
);

create index if not exists dept_contours_geom_idx
  on public.dept_contours using gist (geom);

alter table public.dept_contours enable row level security;
-- Aucune politique, tous droits révoqués : table purement interne.
revoke all on public.dept_contours from anon, authenticated;

insert into public.dept_contours (code, geom) values
  ('04', ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[5.676,44.1914],[5.7954,44.2135],[5.9093,44.1905],[5.9147,44.2034],[5.8764,44.2144],[5.86,44.2451],[5.8267,44.2625],[5.8239,44.2789],[5.8361,44.2975],[5.8666,44.2958],[5.8801,44.271],[5.9218,44.2484],[5.9127,44.2887],[5.9264,44.2932],[5.9248,44.315],[5.8984,44.3157],[5.9032,44.3374],[5.9374,44.3594],[5.9571,44.3974],[6.0184,44.4185],[6.057,44.452],[6.0757,44.4385],[6.0838,44.4778],[6.1556,44.462],[6.1599,44.435],[6.175,44.4388],[6.2282,44.3817],[6.2625,44.4123],[6.2328,44.4629],[6.2935,44.4809],[6.3271,44.4635],[6.3483,44.4981],[6.3324,44.51],[6.3573,44.5226],[6.3988,44.4942],[6.4121,44.4701],[6.435,44.4751],[6.4686,44.4513],[6.6323,44.4469],[6.6417,44.4855],[6.6685,44.5003],[6.6809,44.541],[6.7372,44.5525],[6.7718,44.5758],[6.769,44.5882],[6.8434,44.609],[6.9156,44.66],[6.9483,44.6548],[6.9683,44.6247],[6.9377,44.6034],[6.9329,44.5734],[6.9019,44.5539],[6.8786,44.5543],[6.8534,44.5288],[6.8774,44.4808],[6.9481,44.4297],[6.8929,44.4208],[6.8952,44.3702],[6.8596,44.3442],[6.8089,44.3305],[6.7865,44.2895],[6.7903,44.2723],[6.7635,44.2796],[6.7591,44.2621],[6.724,44.2498],[6.7176,44.2082],[6.6865,44.1692],[6.7073,44.1444],[6.7076,44.1245],[6.7565,44.0796],[6.7471,44.0409],[6.8387,43.9897],[6.8476,43.9544],[6.8755,43.9528],[6.8843,43.935],[6.9133,43.9278],[6.944,43.8995],[6.8846,43.8891],[6.83,43.9184],[6.7986,43.9097],[6.7816,43.8835],[6.7484,43.8717],[6.6716,43.8873],[6.6962,43.8755],[6.7028,43.856],[6.6782,43.852],[6.6679,43.8306],[6.7028,43.8242],[6.7061,43.8084],[6.6364,43.7889],[6.6237,43.8047],[6.5869,43.8053],[6.5457,43.7753],[6.5424,43.7919],[6.5173,43.8088],[6.4869,43.7917],[6.4388,43.7978],[6.4144,43.7916],[6.4134,43.7602],[6.3835,43.7344],[6.3263,43.7469],[6.2686,43.7772],[6.2542,43.8004],[6.2167,43.7995],[6.1543,43.7436],[6.1067,43.7445],[6.077,43.7072],[6.0351,43.6941],[6.0395,43.6786],[6.0217,43.6683],[5.9879,43.6951],[5.9854,43.714],[5.9405,43.7273],[5.9388,43.7488],[5.9255,43.7569],[5.903,43.7534],[5.905,43.7374],[5.8845,43.7239],[5.849,43.7182],[5.8312,43.7469],[5.7813,43.7557],[5.7573,43.7294],[5.7169,43.7555],[5.7136,43.7811],[5.6857,43.7872],[5.6544,43.8251],[5.5746,43.8303],[5.5443,43.8184],[5.5486,43.8515],[5.5735,43.8634],[5.6082,43.9148],[5.5816,43.9151],[5.5689,43.9423],[5.5127,43.9454],[5.5077,43.9577],[5.5436,44.026],[5.545,44.0684],[5.5026,44.0634],[5.4988,44.1157],[5.5414,44.1326],[5.5513,44.1498],[5.5787,44.1521],[5.5644,44.1709],[5.5762,44.188],[5.6093,44.1907],[5.6396,44.1676],[5.6311,44.1506],[5.6779,44.1464],[5.6824,44.1636],[5.6433,44.1707],[5.6516,44.1896],[5.676,44.1914]]]]}')), 4326)), 3)),
  ('05', ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[6.2606,45.1268],[6.2935,45.1085],[6.3345,45.1228],[6.3657,45.101],[6.3747,45.0832],[6.3649,45.0702],[6.4518,45.0517],[6.4873,45.0568],[6.4805,45.0942],[6.5104,45.109],[6.5392,45.0991],[6.5765,45.1231],[6.6155,45.1215],[6.6452,45.0756],[6.6621,45.0716],[6.6739,45.0196],[6.7454,45.0143],[6.7517,44.9966],[6.7378,44.9892],[6.7652,44.962],[6.7441,44.9372],[6.7609,44.9332],[6.7507,44.9057],[6.8015,44.8911],[6.8034,44.8781],[6.8632,44.8506],[6.9132,44.845],[6.9312,44.8635],[7.0012,44.8423],[7.0238,44.8231],[6.9994,44.7897],[7.0223,44.7708],[7.0299,44.7298],[7.066,44.7133],[7.0771,44.6809],[6.9871,44.6901],[6.9483,44.6548],[6.9156,44.66],[6.8434,44.609],[6.769,44.5882],[6.7718,44.5758],[6.7372,44.5525],[6.6809,44.541],[6.6685,44.5003],[6.6417,44.4855],[6.6323,44.4469],[6.4686,44.4513],[6.435,44.4751],[6.4121,44.4701],[6.3988,44.4942],[6.3573,44.5226],[6.3324,44.51],[6.3483,44.4981],[6.3271,44.4635],[6.2935,44.4809],[6.2328,44.4629],[6.2625,44.4123],[6.2282,44.3817],[6.175,44.4388],[6.1599,44.435],[6.1556,44.462],[6.0809,44.4766],[6.0757,44.4385],[6.057,44.452],[6.0184,44.4185],[5.9571,44.3974],[5.9374,44.3594],[5.9032,44.3374],[5.8984,44.3157],[5.9248,44.315],[5.9264,44.2932],[5.9127,44.2887],[5.9218,44.2484],[5.8801,44.271],[5.8666,44.2958],[5.8361,44.2975],[5.8239,44.2789],[5.8267,44.2625],[5.86,44.2451],[5.8764,44.2144],[5.9147,44.2034],[5.9093,44.1905],[5.7954,44.2135],[5.6782,44.1905],[5.6864,44.1972],[5.673,44.2462],[5.6866,44.2669],[5.6756,44.2759],[5.6468,44.2671],[5.6321,44.2839],[5.6382,44.299],[5.6079,44.3067],[5.6308,44.333],[5.5473,44.33],[5.5214,44.3511],[5.4913,44.3379],[5.4626,44.3674],[5.4319,44.371],[5.443,44.3912],[5.4184,44.4248],[5.4367,44.4337],[5.4765,44.4197],[5.4983,44.4373],[5.4644,44.4479],[5.4584,44.4994],[5.6034,44.4654],[5.6298,44.5012],[5.6645,44.5019],[5.6274,44.5346],[5.5972,44.5433],[5.6353,44.6091],[5.6472,44.6116],[5.6417,44.6511],[5.728,44.6392],[5.7536,44.6486],[5.7539,44.6627],[5.7906,44.6533],[5.7994,44.6741],[5.8304,44.6906],[5.8012,44.7083],[5.8293,44.7416],[5.8271,44.7597],[5.8818,44.7466],[5.9002,44.7583],[5.9511,44.7596],[5.9532,44.7713],[5.9802,44.7812],[5.9517,44.8007],[5.9602,44.812],[6.0302,44.8381],[6.0565,44.8158],[6.1329,44.8645],[6.1684,44.8522],[6.247,44.8517],[6.295,44.8742],[6.3241,44.8522],[6.354,44.8535],[6.3588,44.9413],[6.3229,44.953],[6.3295,44.9692],[6.3148,44.9802],[6.3235,44.9991],[6.2534,44.9952],[6.2039,45.0125],[6.2201,45.0654],[6.2445,45.0717],[6.2289,45.1083],[6.2606,45.1268]]]]}')), 4326)), 3)),
  ('13', ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[5.3057,43.2768],[5.288,43.2612],[5.3036,43.2763],[5.2916,43.2803],[5.3239,43.2862],[5.3057,43.2768]]],[[[5.335,43.3373],[5.3617,43.3087],[5.3577,43.2993],[5.3532,43.3184],[5.3189,43.3471],[5.335,43.3373]]],[[[4.7391,43.9241],[4.8531,43.9114],[4.9663,43.8717],[5.0295,43.8278],[5.0497,43.7887],[5.1733,43.7388],[5.23,43.7477],[5.3157,43.7365],[5.4376,43.6817],[5.5315,43.659],[5.6069,43.6587],[5.6736,43.6937],[5.7141,43.6913],[5.7537,43.7246],[5.7853,43.7175],[5.7876,43.697],[5.8132,43.689],[5.7987,43.6612],[5.6987,43.6425],[5.6781,43.6114],[5.6916,43.5844],[5.656,43.5774],[5.7251,43.5513],[5.7158,43.5032],[5.6986,43.4834],[5.7507,43.4345],[5.7884,43.4203],[5.7553,43.4023],[5.7013,43.4081],[5.6828,43.3992],[5.705,43.3559],[5.6755,43.3196],[5.7266,43.3174],[5.7628,43.2824],[5.7609,43.2673],[5.6839,43.2361],[5.6719,43.1793],[5.6242,43.187],[5.6041,43.1604],[5.5693,43.1749],[5.5357,43.2142],[5.4999,43.1969],[5.4589,43.2112],[5.4452,43.2112],[5.4545,43.202],[5.3418,43.2126],[5.3761,43.2552],[5.3455,43.2816],[5.3735,43.2942],[5.3602,43.2957],[5.3511,43.3347],[5.3083,43.3614],[5.2294,43.3287],[5.0502,43.325],[5.0199,43.3423],[5.0253,43.3555],[4.9868,43.3922],[5.0011,43.3982],[4.9748,43.4012],[4.97,43.4249],[4.9193,43.4309],[4.8884,43.4122],[4.8935,43.4041],[4.8847,43.4137],[4.9034,43.4297],[4.8822,43.4193],[4.8608,43.454],[4.8502,43.4508],[4.8773,43.4105],[4.8658,43.4046],[4.8244,43.4244],[4.8615,43.4008],[4.8387,43.3945],[4.8718,43.39],[4.8289,43.3759],[4.883,43.3565],[4.9111,43.3871],[4.9175,43.3799],[4.8355,43.3287],[4.7738,43.3485],[4.6591,43.3462],[4.5858,43.3601],[4.5556,43.3828],[4.5929,43.4056],[4.5881,43.4227],[4.5307,43.4526],[4.4013,43.4468],[4.2303,43.4602],[4.2397,43.4992],[4.3247,43.5282],[4.3079,43.5452],[4.314,43.5556],[4.3341,43.5354],[4.3874,43.5622],[4.4093,43.5611],[4.4166,43.5713],[4.4029,43.573],[4.4255,43.5852],[4.4607,43.5893],[4.4725,43.612],[4.4398,43.6107],[4.4262,43.6245],[4.4513,43.6641],[4.4775,43.6725],[4.4872,43.6992],[4.5399,43.7073],[4.6274,43.6854],[4.6123,43.7248],[4.6519,43.7841],[4.6424,43.8314],[4.6668,43.8461],[4.6415,43.8511],[4.6419,43.8675],[4.6922,43.8842],[4.7391,43.9241]],[[5.1181,43.5132],[5.1087,43.5255],[5.0456,43.5218],[5.0133,43.5545],[5.0009,43.4741],[5.0519,43.4636],[5.0608,43.4029],[5.1373,43.4002],[5.2044,43.4421],[5.1984,43.4509],[5.2266,43.453],[5.2248,43.4811],[5.2056,43.492],[5.1459,43.4581],[5.1181,43.5132]]]]}')), 4326)), 3)),
  ('26', ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[4.8005,45.2984],[4.8588,45.309],[4.8586,45.2985],[4.8797,45.2969],[4.9951,45.3441],[5.0096,45.3422],[5.0227,45.3178],[5.0543,45.319],[5.0754,45.2818],[5.1367,45.298],[5.1209,45.2476],[5.1415,45.2436],[5.1582,45.2555],[5.2017,45.2174],[5.1674,45.2101],[5.1643,45.1976],[5.1898,45.1694],[5.1874,45.1208],[5.1541,45.0793],[5.1352,45.0742],[5.1625,45.0658],[5.1794,45.0833],[5.2082,45.0842],[5.2677,45.0547],[5.2928,45.0639],[5.3202,45.0516],[5.3403,45.0621],[5.346,45.048],[5.3858,45.0346],[5.3965,45.0395],[5.3831,45.0559],[5.4127,45.0446],[5.461,45.0864],[5.483,45.0838],[5.4942,45.0717],[5.4749,45.0703],[5.4649,45.0459],[5.4936,44.9961],[5.4777,44.9667],[5.4836,44.9223],[5.4638,44.826],[5.4848,44.8231],[5.4619,44.7949],[5.5545,44.7675],[5.5498,44.7945],[5.582,44.7779],[5.5868,44.7632],[5.6263,44.7533],[5.6523,44.7227],[5.7041,44.7293],[5.7561,44.6959],[5.8015,44.7068],[5.8271,44.7003],[5.8297,44.6887],[5.7994,44.6741],[5.7906,44.6533],[5.7539,44.6627],[5.7536,44.6486],[5.728,44.6392],[5.6417,44.6511],[5.6472,44.6116],[5.6353,44.6091],[5.5972,44.5433],[5.6274,44.5346],[5.6645,44.5019],[5.6298,44.5012],[5.6034,44.4654],[5.4584,44.4994],[5.4644,44.4479],[5.4977,44.4382],[5.4936,44.4282],[5.4765,44.4197],[5.4367,44.4337],[5.4184,44.4248],[5.443,44.3912],[5.4319,44.371],[5.4626,44.3674],[5.4913,44.3379],[5.5214,44.3511],[5.5473,44.33],[5.6308,44.333],[5.6079,44.3067],[5.6382,44.299],[5.6321,44.2839],[5.6468,44.2671],[5.6756,44.2759],[5.6866,44.2669],[5.673,44.2462],[5.6864,44.1946],[5.6516,44.1896],[5.6433,44.1707],[5.6824,44.1636],[5.6779,44.1464],[5.6311,44.1506],[5.6396,44.1676],[5.6021,44.1915],[5.5746,44.1868],[5.5644,44.1709],[5.583,44.1576],[5.5513,44.1498],[5.5414,44.1326],[5.5026,44.1157],[5.4547,44.1192],[5.4358,44.1523],[5.3832,44.1553],[5.3845,44.2012],[5.3553,44.2146],[5.3033,44.2054],[5.2523,44.2312],[5.2308,44.2119],[5.1549,44.2309],[5.1607,44.2666],[5.1471,44.2756],[5.1681,44.2899],[5.1677,44.3148],[5.108,44.2773],[5.0765,44.2841],[5.0606,44.3081],[4.9329,44.2621],[4.8791,44.2615],[4.8266,44.2283],[4.8141,44.2323],[4.8046,44.3039],[4.7797,44.3194],[4.6506,44.3298],[4.649,44.3725],[4.6674,44.4307],[4.7004,44.4599],[4.6882,44.5055],[4.7074,44.5339],[4.6928,44.5585],[4.7103,44.5816],[4.7415,44.5893],[4.7791,44.6547],[4.7609,44.7717],[4.7957,44.7938],[4.7999,44.813],[4.8225,44.8171],[4.8202,44.8362],[4.8444,44.846],[4.8609,44.8737],[4.8559,44.9014],[4.8866,44.9367],[4.8362,45.0079],[4.8403,45.0358],[4.8608,45.0554],[4.8299,45.0718],[4.83,45.0973],[4.8032,45.125],[4.8291,45.1567],[4.8093,45.1688],[4.8013,45.2429],[4.8095,45.2899],[4.8005,45.2984]],[[4.8929,44.3648],[4.8695,44.3451],[4.8953,44.3381],[4.8816,44.3249],[4.8917,44.3043],[4.9222,44.3088],[4.987,44.2927],[5.0239,44.3606],[5.0721,44.3804],[5.0156,44.393],[5.0188,44.416],[5.0011,44.4126],[4.9704,44.4314],[4.9185,44.4078],[4.8929,44.3648]]]]}')), 4326)), 3)),
  ('83', ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[6.4348,43.0155],[6.4733,43.0469],[6.5113,43.0468],[6.4875,43.0427],[6.471,43.0166],[6.4504,43.0174],[6.4383,43.0036],[6.4348,43.0155]]],[[[6.3971,42.9928],[6.3703,43.0008],[6.3833,43.0138],[6.4199,43.0138],[6.3971,42.9928]]],[[[6.2441,43.02],[6.2508,42.9997],[6.2056,42.9818],[6.1613,42.9989],[6.1796,43.0086],[6.2117,43.0026],[6.2441,43.02]]],[[[5.7806,43.0698],[5.7786,43.081],[5.7922,43.0774],[5.7806,43.0698]]],[[[5.7537,43.7246],[5.7813,43.7557],[5.8312,43.7469],[5.849,43.7182],[5.8845,43.7239],[5.905,43.7374],[5.903,43.7534],[5.9227,43.7575],[5.9388,43.7488],[5.9405,43.7273],[5.9854,43.714],[5.9879,43.6951],[6.0217,43.6683],[6.0395,43.6786],[6.0351,43.6941],[6.077,43.7072],[6.1067,43.7445],[6.1543,43.7436],[6.2167,43.7995],[6.2542,43.8004],[6.2686,43.7772],[6.3263,43.7469],[6.3835,43.7344],[6.4134,43.7602],[6.4144,43.7916],[6.4869,43.7917],[6.5173,43.8088],[6.5424,43.7919],[6.5457,43.7753],[6.5869,43.8053],[6.6193,43.8058],[6.6574,43.7487],[6.6827,43.7579],[6.715,43.7387],[6.7525,43.7411],[6.7742,43.7036],[6.7608,43.6665],[6.7987,43.6282],[6.8168,43.6298],[6.8517,43.6044],[6.8943,43.6115],[6.912,43.5983],[6.8984,43.5816],[6.9082,43.5639],[6.8878,43.5527],[6.8788,43.5292],[6.8964,43.5272],[6.8842,43.5025],[6.9333,43.4777],[6.924,43.4505],[6.8917,43.4284],[6.8597,43.4333],[6.8563,43.4115],[6.8291,43.4185],[6.789,43.4081],[6.7663,43.4237],[6.7484,43.4198],[6.7141,43.3718],[6.7165,43.3475],[6.68,43.3403],[6.6654,43.3252],[6.6713,43.3126],[6.635,43.3075],[6.5852,43.2795],[6.582,43.2675],[6.5935,43.2623],[6.6402,43.2744],[6.6652,43.2649],[6.6758,43.2785],[6.6976,43.2665],[6.6644,43.2413],[6.6643,43.2118],[6.6811,43.1998],[6.643,43.1871],[6.6466,43.1677],[6.6183,43.1594],[6.6017,43.1821],[6.562,43.1891],[6.5369,43.1788],[6.5346,43.1633],[6.4966,43.1512],[6.4642,43.1575],[6.4387,43.1422],[6.4291,43.1514],[6.3845,43.144],[6.3598,43.1199],[6.3643,43.0863],[6.3215,43.0914],[6.3167,43.1062],[6.2893,43.1067],[6.2749,43.1207],[6.201,43.1161],[6.1547,43.0798],[6.152,43.0372],[6.1727,43.0328],[6.1488,43.0259],[6.0913,43.0354],[6.1316,43.048],[6.114,43.0837],[6.0215,43.0783],[6.0235,43.0948],[6.0055,43.104],[5.9257,43.1023],[5.9343,43.1186],[5.9206,43.1239],[5.8805,43.105],[5.91,43.0999],[5.8968,43.0805],[5.9382,43.0846],[5.947,43.0677],[5.8902,43.078],[5.859,43.048],[5.8288,43.0494],[5.7924,43.0687],[5.8125,43.0959],[5.8082,43.1152],[5.7673,43.1155],[5.781,43.1301],[5.7713,43.1389],[5.7523,43.1301],[5.716,43.148],[5.6949,43.1436],[5.6822,43.1555],[5.6946,43.1718],[5.6719,43.1793],[5.6839,43.2361],[5.7609,43.2673],[5.7628,43.2824],[5.7266,43.3174],[5.6755,43.3196],[5.705,43.3559],[5.6828,43.3992],[5.7013,43.4081],[5.7553,43.4023],[5.7884,43.4203],[5.7507,43.4345],[5.6986,43.4834],[5.7158,43.5032],[5.7251,43.5513],[5.656,43.574],[5.6916,43.5844],[5.6781,43.6114],[5.6987,43.6425],[5.7987,43.6612],[5.8132,43.689],[5.7876,43.697],[5.7853,43.7175],[5.7537,43.7246]]]]}')), 4326)), 3)),
  ('84', ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[4.8929,44.3648],[4.9185,44.4078],[4.9704,44.4314],[5.0011,44.4126],[5.0188,44.416],[5.0156,44.393],[5.0721,44.3804],[5.0239,44.3606],[4.987,44.2927],[4.9222,44.3088],[4.8917,44.3043],[4.8816,44.3249],[4.8953,44.3381],[4.8695,44.3451],[4.8929,44.3648]]],[[[4.6492,44.2704],[4.6506,44.3298],[4.7797,44.3194],[4.8046,44.3039],[4.8141,44.2323],[4.8266,44.2283],[4.8791,44.2615],[4.9329,44.2621],[5.0606,44.3081],[5.0765,44.2841],[5.108,44.2773],[5.1677,44.3148],[5.1681,44.2899],[5.1471,44.2756],[5.1607,44.2666],[5.1495,44.2353],[5.1581,44.2288],[5.2308,44.2119],[5.2523,44.2312],[5.3033,44.2054],[5.3553,44.2146],[5.3845,44.2012],[5.3832,44.1553],[5.4358,44.1523],[5.4506,44.1215],[5.4988,44.1157],[5.5026,44.0634],[5.545,44.0684],[5.5436,44.026],[5.5176,43.9917],[5.5092,43.9517],[5.5689,43.9423],[5.5816,43.9151],[5.6082,43.9148],[5.5735,43.8634],[5.5486,43.8515],[5.5443,43.8184],[5.5746,43.8303],[5.6544,43.8251],[5.6857,43.7872],[5.7136,43.7811],[5.7169,43.7555],[5.7573,43.7294],[5.7102,43.69],[5.6736,43.6937],[5.6069,43.6587],[5.5315,43.659],[5.4376,43.6817],[5.3157,43.7365],[5.23,43.7477],[5.1733,43.7388],[5.0497,43.7887],[5.0295,43.8278],[4.9663,43.8717],[4.8531,43.9114],[4.7391,43.9241],[4.8116,43.9618],[4.8125,43.9877],[4.8421,43.9865],[4.8433,44.0099],[4.8212,44.0165],[4.7583,44.0879],[4.7206,44.0818],[4.7061,44.1078],[4.7221,44.1874],[4.7058,44.1928],[4.7066,44.2144],[4.6742,44.214],[4.6779,44.2341],[4.6492,44.2704]]]]}')), 4326)), 3))
on conflict (code) do update set geom = excluded.geom;

-- -----------------------------------------------------------------------------
-- B. Département d'un point
-- -----------------------------------------------------------------------------
-- ⚠ ORDER BY ST_Area : l'enclave des Papes (Valréas, 84) est entourée par la
-- Drôme. Les deux contours étant simplifiés séparément, un point de l'enclave
-- peut techniquement tomber dans les deux ; le plus petit territoire (le 84,
-- 3 567 km² contre 6 530) gagne — c'est le bon.
-- Le repli à 1 500 m rattrape les points que la simplification laisse juste
-- hors du trait : la tolérance étant de ~800 m, tout point réellement dans un
-- département est soit dedans, soit à moins de 1 500 m.
create or replace function public.dept_of_point(p geography)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select code from public.dept_contours
      where ST_Contains(geom, p::geometry)
      order by ST_Area(geom) asc
      limit 1),
    (select code from public.dept_contours
      where ST_DWithin(geom::geography, p, 1500)
      order by ST_Distance(geom::geography, p) asc
      limit 1)
  )
  where p is not null;
$$;

-- Purement interne (triggers) : aucun client n'a besoin de l'appeler.
revoke execute on function public.dept_of_point(geography) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- C. events.dept
-- -----------------------------------------------------------------------------
alter table public.events add column if not exists dept text;
create index if not exists events_dept_idx on public.events (dept);

comment on column public.events.dept is
  'Département du lieu (04, 05, 13, 26, 83, 84), calculé par trigger depuis '
  'location. NULL = sans coordonnées ou hors des départements couverts.';

create or replace function public.set_event_dept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.dept := public.dept_of_point(new.location);
  return new;
end;
$$;

-- ⚠ SANS liste de colonnes (pas de « update of location ») : tout le
-- cloisonnement des modérateurs repose sur dept, et le droit d'UPDATE accordé
-- par PostgREST est table entière — un auteur pourrait sinon écrire dept
-- directement (PATCH {"dept":"83"}) sans que le trigger ne corrige, et choisir
-- ainsi qui le modère. En recalculant à CHAQUE écriture, dept reste une pure
-- fonction de location : toute valeur écrite à la main est aussitôt écrasée.
drop trigger if exists set_event_dept_trg on public.events;
create trigger set_event_dept_trg
  before insert or update on public.events
  for each row execute function public.set_event_dept();

-- Rattrapage des événements existants (une seule fois ; le trigger prend la
-- suite pour toutes les écritures futures).
update public.events
   set dept = public.dept_of_point(location)
 where location is not null;

-- Ceinture-bretelles : même si le trigger disparaissait un jour, la colonne ne
-- peut contenir que des codes connus. NOT VALID = les lignes déjà en place ne
-- sont pas re-vérifiées (elles sortent de dept_of_point, donc saines) et la
-- transaction du SQL Editor ne peut pas échouer dessus.
alter table public.events drop constraint if exists events_dept_valide;
alter table public.events
  add constraint events_dept_valide
  check (dept is null or dept in ('04','05','13','26','83','84'))
  not valid;

-- -----------------------------------------------------------------------------
-- D. La vue expose la nouvelle colonne
-- -----------------------------------------------------------------------------
-- ⚠ `select e.*` fige la liste des colonnes à la création : il faut recréer la
-- vue (même manœuvre qu'en 0013, avec la fonction dépendante).
drop function if exists public.events_within_radius(float, float, float);
drop view if exists public.events_geo;

create view public.events_geo
  with (security_invoker = on)
as
  select
    e.*,
    ST_Y(e.location::geometry) as lat,
    ST_X(e.location::geometry) as lng
  from public.events e;

grant select on public.events_geo to anon, authenticated;

create function public.events_within_radius(lat float, lng float, radius_m float)
returns setof public.events_geo
language sql
stable
set search_path = public
as $$
  select *
  from public.events_geo g
  where g.location is not null
    and ST_DWithin(g.location, ST_MakePoint(lng, lat)::geography, radius_m)
  order by g.starts_at;
$$;

grant execute on function public.events_within_radius(float, float, float)
  to anon, authenticated;

-- -----------------------------------------------------------------------------
-- E. Visites : d'où viennent les gens
-- -----------------------------------------------------------------------------
-- Seul le DÉPARTEMENT est stocké, jamais une position : c'est le choix de
-- Matthieu (option « GPS quand il est donné », département seul).
alter table public.app_visits  add column if not exists dept text;
alter table public.anon_visits add column if not exists dept text;

-- Les deux RPC gagnent un paramètre facultatif : l'ancien client (bundle
-- encore en cache chez les utilisateurs) continue d'appeler sans argument.
-- CREATE OR REPLACE ne sait pas changer une signature → drop puis create.
drop function if exists public.record_visit();
create function public.record_visit(p_dept text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.app_visits (user_id, day, dept)
  select auth.uid(),
         (now() at time zone 'Europe/Paris')::date,
         case when p_dept in ('04','05','13','26','83','84') then p_dept end
  where auth.uid() is not null
  on conflict do nothing;
$$;

revoke execute on function public.record_visit(text) from public, anon;
grant execute on function public.record_visit(text) to authenticated;

drop function if exists public.record_anon_visit(text);
create function public.record_anon_visit(p_visitor text, p_dept text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.anon_visits (visitor, day, dept)
  select p_visitor,
         (now() at time zone 'Europe/Paris')::date,
         case when p_dept in ('04','05','13','26','83','84') then p_dept end
  where auth.uid() is null
    and p_visitor ~ '^[0-9a-f]{32}$'
  on conflict do nothing;
$$;

revoke execute on function public.record_anon_visit(text, text) from public;
grant execute on function public.record_anon_visit(text, text) to anon, authenticated;

-- La visite du jour est enregistrée à l'OUVERTURE de l'app, avant que la carte
-- n'obtienne le GPS : cette fonction complète la ligne du jour après coup.
-- Le premier département observé gagne (where dept is null) : quelqu'un qui
-- traverse deux départements dans la journée n'écrase pas sa ligne.
create or replace function public.tag_visit_dept(p_dept text, p_visitor text default null)
returns void
language sql
security definer
set search_path = public
as $$
  with jour as (
    select (now() at time zone 'Europe/Paris')::date as d
  ),
  code as (
    select case when p_dept in ('04','05','13','26','83','84') then p_dept end as c
  ),
  maj_membre as (
    update public.app_visits
       set dept = (select c from code)
     where (select c from code) is not null
       and auth.uid() is not null
       and user_id = auth.uid()
       and day = (select d from jour)
       and dept is null
    returning 1
  )
  update public.anon_visits
     set dept = (select c from code)
   where (select c from code) is not null
     and auth.uid() is null
     and p_visitor ~ '^[0-9a-f]{32}$'
     and visitor = p_visitor
     and day = (select d from jour)
     and dept is null;
$$;

revoke execute on function public.tag_visit_dept(text, text) from public;
grant execute on function public.tag_visit_dept(text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- F. admin_stats : passages par département (30 jours)
-- -----------------------------------------------------------------------------
create or replace function public.admin_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  paris_now timestamptz := now();
  month_start timestamptz := (date_trunc('month', (now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris');
  today date := (now() at time zone 'Europe/Paris')::date;
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;

  select jsonb_build_object(
    'generated_at', paris_now,
    'month_start', month_start,

    'membres', (
      select jsonb_build_object(
        'total',   count(*)::int,
        'admins',  count(*) filter (where role = 'admin')::int,
        'new_7j',  count(*) filter (where created_at >= paris_now - interval '7 days')::int,
        'new_30j', count(*) filter (where created_at >= paris_now - interval '30 days')::int
      )
      from public.profiles
    ),

    'connexions', (
      select jsonb_build_object(
        'actifs_24h',       count(*) filter (where last_sign_in_at >= paris_now - interval '24 hours')::int,
        'actifs_7j',        count(*) filter (where last_sign_in_at >= paris_now - interval '7 days')::int,
        'actifs_30j',       count(*) filter (where last_sign_in_at >= paris_now - interval '30 days')::int,
        'jamais_connectes', count(*) filter (where last_sign_in_at is null)::int,
        'emails_confirmes', count(*) filter (where email_confirmed_at is not null)::int
      )
      from auth.users
    ),

    'visites', (
      select jsonb_build_object(
        'aujourdhui', count(*) filter (where day = today)::int,
        'hier',       count(*) filter (where day = today - 1)::int,
        'uniques_7j', count(distinct user_id) filter (where day >= today - 6)::int,
        'uniques_30j',count(distinct user_id) filter (where day >= today - 29)::int,
        'uniques_total', count(distinct user_id)::int,
        'depuis',     min(day)::text,
        'par_jour', (
          select coalesce(jsonb_agg(to_jsonb(t) order by t.label), '[]'::jsonb)
          from (
            select day::text as label, count(*)::int as n
            from public.app_visits
            where day >= today - 29
            group by 1
          ) t
        )
      )
      from public.app_visits
    ),

    'visites_anonymes', (
      select jsonb_build_object(
        'aujourdhui', count(*) filter (where day = today)::int,
        'hier',       count(*) filter (where day = today - 1)::int,
        'uniques_7j', count(distinct visitor) filter (where day >= today - 6)::int,
        'uniques_30j',count(distinct visitor) filter (where day >= today - 29)::int,
        'uniques_total', count(distinct visitor)::int,
        'depuis',     min(day)::text,
        'par_jour', (
          select coalesce(jsonb_agg(to_jsonb(t) order by t.label), '[]'::jsonb)
          from (
            select day::text as label, count(*)::int as n
            from public.anon_visits
            where day >= today - 29
            group by 1
          ) t
        )
      )
      from public.anon_visits
    ),

    -- Passages (lignes visiteur×jour) des 30 derniers jours, membres et
    -- anonymes réunis, par département. '—' = passage sans département connu
    -- (GPS refusé, carte jamais ouverte…).
    'par_departement', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
      from (
        select coalesce(v.dept, '—') as code, count(*)::int as n
        from (
          select dept from public.app_visits  where day >= today - 29
          union all
          select dept from public.anon_visits where day >= today - 29
        ) v
        group by 1
      ) t
    ),

    'evenements', (
      select jsonb_build_object(
        'total',     count(*)::int,
        'approuves', count(*) filter (where status = 'approved')::int,
        'en_attente',count(*) filter (where status = 'pending')::int,
        'rejetes',   count(*) filter (where status = 'rejected')::int,
        'a_venir',   count(*) filter (where coalesce(ends_at, starts_at) >= paris_now)::int,
        'payants',   count(*) filter (where is_paid)::int,
        'new_7j',    count(*) filter (where created_at >= paris_now - interval '7 days')::int,
        'new_30j',   count(*) filter (where created_at >= paris_now - interval '30 days')::int,
        'a_purger',  count(*) filter (where coalesce(ends_at, starts_at) < month_start)::int
      )
      from public.events
    ),

    -- Où se passe l'activité : événements à venir par département.
    'evenements_par_departement', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
      from (
        select coalesce(dept, '—') as code, count(*)::int as n
        from public.events
        where status = 'approved'
          and coalesce(ends_at, starts_at) >= paris_now
        group by 1
      ) t
    ),

    'par_categorie', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
      from (
        select coalesce(nullif(category, ''), 'Non classé') as label, count(*)::int as n
        from public.events
        group by 1
      ) t
    ),

    'par_mois', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.label), '[]'::jsonb)
      from (
        select to_char(starts_at at time zone 'Europe/Paris', 'YYYY-MM') as label,
               count(*)::int as n
        from public.events
        where starts_at >= month_start - interval '5 months'
        group by 1
      ) t
    ),

    'top_auteurs', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
      from (
        select coalesce(p.display_name, 'Anonyme') as label, count(*)::int as n
        from public.events e
        join public.profiles p on p.id = e.created_by
        group by 1
        order by 2 desc
        limit 8
      ) t
    ),

    'favoris', (
      select jsonb_build_object('total', count(*)::int) from public.gems
    ),

    'photos', (
      select jsonb_build_object('total', count(*)::int) from public.event_photos
    ),

    'retours', (
      select jsonb_build_object(
        'total', count(*)::int,
        'bugs',  count(*) filter (where type = 'bug')::int,
        'avis',  count(*) filter (where type = 'avis')::int
      )
      from public.feedback
    )
  )
  into result;

  return result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Vérification — tout doit être vrai, et les trois villes bien rattachées
-- -----------------------------------------------------------------------------
-- ⚠ N'appelle AUCUNE fonction réservée aux administrateurs (le SQL Editor
-- s'exécute sans utilisateur : l'exception annulerait toute la migration).
select
  (select count(*) from public.dept_contours) = 6                                as six_contours,
  public.dept_of_point(ST_SetSRID(ST_MakePoint(5.7803, 43.9597), 4326)::geography) as forcalquier_attendu_04,
  public.dept_of_point(ST_SetSRID(ST_MakePoint(4.9917, 44.3833), 4326)::geography) as valreas_attendu_84,
  public.dept_of_point(ST_SetSRID(ST_MakePoint(5.1400, 44.3606), 4326)::geography) as nyons_attendu_26,
  (select count(*) from public.events where dept is not null)                     as evenements_rattaches,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='app_visits'
             and column_name='dept')                                              as visites_dept,
  (select pg_get_functiondef(p.oid) like '%par_departement%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='admin_stats')                         as stats_enrichies;

-- =============================================================================
-- Fin de migration 0019
-- =============================================================================
