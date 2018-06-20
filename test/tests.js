'use strict';

const ClientSuccess = require('../clientSuccessClient');
const chai          = require('chai');
const expect        = require('chai').expect;

const config = require('./config');

chai.use(require('chai-as-promised'));

describe('clientSuccessClient', function() {

	const runWriteTests = true; // true = run all tests that reach out and write to ClientSuccess

	// array for all users we have created through our tests
	const createdTestUsers = [];

	// initialize ClientSuccess
	const CS = new ClientSuccess(config.username, config.password);

	describe('authenticate', function() {
		it('should be able to authenticate', async function() {
			const client = new ClientSuccess(config.username, config.password);

			await client.authenticate(); // force client to authenticate with ClientSuccess

			expect(client.authToken).to.not.be.null;
		});

		it('should throw an error when given bad credentials', async function() {
			const client = new ClientSuccess('wrong', 'wrong'); // wrong combo
			return expect(client.authenticate()).to.eventually.be.rejectedWith({ status : 401 });
		});
	});

	describe('hitClientSuccessAPI', function() {
		it('should detect a de-authed access token and generate a new token', async function() {
			this.timeout(15000); // We shouldn't have to wait too long for this test, but unfortunatley we do.
			CS.authToken = '8b613c39-40a5-4901-8a93-d28f745f29ac'; // set a bad token for testing 401 failure

			const testClient = await CS.getClient(90185858);

			return expect(testClient.name).to.equal('TEST user 1525729614630');
		});
	});

	describe('getClient', function() {
		let testClient;

		it('should return back the object of an existing user', async function() {
			testClient = await CS.getClient(90185858);
			return expect(testClient.name).to.equal('TEST user 1525729614630');
		});

		it('should accept string clientIds', async function() {
			testClient = await CS.getClient('90185858');
			return expect(testClient.name).to.equal('TEST user 1525729614630');
		});

		it('should return back a 404 error object when the user does not exist', async function() {
			return expect(CS.getClient(1)).to.eventually.be.rejectedWith({ status : 404 });

		});
	});

	describe('createClient', async function() {
		let testClient;

		afterEach(async function() {
			// clean up the ClientSuccess data after each create
			if (testClient) {
				await CS.closeClient(testClient.id);
				testClient = null; // clear out the object
			}
		});

		it('should create a new test client', async function() {
			const newUserName = `TEST user ${(new Date()).getTime()}`;

			const testClientAttributes = {
				name : newUserName,
			};

			testClient = await CS.createClient(testClientAttributes);

			expect(testClient.name).to.equal(newUserName);
		});

		it('should error on invalid data', async function() {
			if (runWriteTests) {
				const newUserName = `TEST user ${(new Date()).getTime()}`;

				const testClientAttributes = {
					name     : newUserName,
					statusId : 'wrong', // 1/Active, 2/Inactive, 3/Trial, 4/Terminated
				};

				expect(CS.createClient(testClientAttributes)).to.eventually.be.rejectedWith({ status : 417 });
			}
		});
		it('should not create a brand new Client, but should update the existing when creating a Client with matching External ID as an existing Client', async function() {
			const testUserName1 = `TEST user ${(new Date()).getTime()}`;
			const testExternalID     = `${(new Date()).getTime()}test`;

			const testClientAttributesInitial1 = {
				name       : testUserName1,
				externalId : testExternalID,
			};

			testClient = await CS.createClient(testClientAttributesInitial1);

			const testUserName2 = `TEST user ${(new Date()).getTime()}2`;
			const testClientAttributesInitial2 = {
				name       : testUserName2,
				externalId : testExternalID,
			};

			const testClient2 = await CS.createClient(testClientAttributesInitial2);

			expect(testClient2.id).to.equal(testClient.id); // it should still equal the initial client ID
			expect(testClient2.name).to.equal(testUserName2);
		});

		it('should create a new fresh Client with custom attribtues', async function() {
			this.timeout(15000);
			const newUserName = `TEST user ${(new Date()).getTime()}`;
			const testExternalID     = `${(new Date()).getTime()}test2`;

			const testClientAttributes = {
				name       : newUserName,
				externalId : testExternalID,
			};

			const testClientCustomAttributes = {
				'Account Notes' : `${newUserName} note`,
			};

			testClient = await CS.createClient(testClientAttributes, testClientCustomAttributes);

			const createdCustomUser = await CS.getClient(testClient.id);

			expect(createdCustomUser.name).to.equal(newUserName);
			// account notes is currently in array position 0
			expect(createdCustomUser.customFieldValues[0].value).equal(`${newUserName} note`);
		});
	});

	describe('updateClient', async function() {
		let testClient;
		const testUserName = `TEST user ${(new Date()).getTime()}`;

		before(async function() {
			// create a test client with initial attributes to use in updateClient tests
			const testUserName = `TEST user ${(new Date()).getTime()}`;

			const testClientAttributesInitial = {
				name : testUserName,
			};

			testClient = await CS.createClient(testClientAttributesInitial);
		});

		it('should successfully update a user', async function() {
			if (runWriteTests) {
				// update test client with new attributes
				const testClientAttributesNew = {
					name : `${testUserName}updated`,
				};

				const updatedClient = await CS.updateClient(testClient.id, testClientAttributesNew);

				// verify that client has been updated
				expect(updatedClient.name).to.equal(`${testUserName}updated`);
			}

		});

		it('should successfully update a user with a string passed as clientId', async function() {
			if (runWriteTests) {
				this.timeout(15000); // extend the timeout for this test, as we are trying to access a ClientSuccess record that we just recently updated

				// update test client with new attributes
				const testClientAttributesNew = {
					name : `${testUserName}updated`,
				};

				const updatedClient = await CS.updateClient(testClient.id, testClientAttributesNew);

				// verify that client has been updated
				expect(updatedClient.name).to.equal(`${testUserName}updated`);
			}

		});

		it('should gracefully fail with a Expectation Failed object when we pass an invalid data type in', async function() {
			// update test client with new attributes
			const testClientAttributesNew = {
				name     : `${testUserName}updated`,
				statusId : 'wrong', // pass some invalid data
			};

			expect(CS.updateClient(testClient.id, testClientAttributesNew)).to.eventually.be.rejectedWith({ status : 417 });
		});

		it('should fail if we pass in an invalid Cliet ID', async function() {
			const testClientAttributesNew = {
				name : `${testUserName}updated`,
			};

			expect(CS.updateClient('abc', testClientAttributesNew)).to.eventually.be.rejectedWith({ status : 400 });
		});

		it('should update custom attributes on the ClientSuccess Client object', async function() {
			const testClientAttributesNew = {
				name : `${testUserName}updated`,
			};

			const testClientCustomAttributes = {
				// SHOULDDO: have config array to specify custom field attributes here
				'Account Notes' : 'Test Notes',
			};

			const updatedClient = await CS.updateClient(testClient.id, testClientAttributesNew, testClientCustomAttributes);

			expect(updatedClient.name).to.equal(`${testUserName}updated`);

			// pull down the Client detail
			testClient = await CS.getClient(updatedClient.id);
			expect(testClient.customFieldValues[0].value).to.equal('Test Notes');
		});

		after(async function() {
			// clean up the test user
			await CS.closeClient(testClient.id);
		});
	});

	describe('upsertClient', async function() {
		let testClient;
		let upsertedClient;
		const upsertedClientArray = [];

		before(async function() {
			// create a test client with initial attributes to use in updateClient tests
			const testClientName = `TEST user ${(new Date()).getTime()}`;

			const testClientAttributesInitial = {
				name : testClientName,
			};

			testClient = await CS.createClient(testClientAttributesInitial);

			// add the clientId to be cleaned up later
			createdTestUsers.push(testClient.id);
		});

		after(async function() {
			this.timeout(15000);
			// we should clean up the test clients after the tests are run
			await CS.closeClient(testClient.id);
			for (let i = 0; i < upsertedClientArray.length; i++) {
				await CS.closeClient(upsertedClientArray[i]);
			}
		});

		it('should automatically create a Client if there is an undefined clientId present in the function arguments', async function() {
			const upsertedClientTestName = `TEST user ${(new Date()).getTime()}`;
			upsertedClient = await CS.upsertClient({
				clientId   : undefined,
				attributes : {
					name : upsertedClientTestName,
				},
			});
			upsertedClientArray.push(upsertedClient.id); // queue this client to be cleaned
			expect(upsertedClient.name).to.equal(upsertedClientTestName);
		});

		it('should automatically create a Client if there is a blank clientId present in the function arguments', async function() {
			const upsertedClientTestName = `TEST user ${(new Date()).getTime()}`;
			upsertedClient = await CS.upsertClient({
				clientId   : '',
				attributes : {
					name : upsertedClientTestName,
				},
			});
			upsertedClientArray.push(upsertedClient.id); // queue this client to be cleaned
			expect(upsertedClient.name).to.equal(upsertedClientTestName);
		});

		it('should automatically create a Client if only attributes are passed in', async function() {
			const upsertedClientTestName = `TEST user ${(new Date()).getTime()}`;
			upsertedClient = await CS.upsertClient({
				attributes : {
					name : upsertedClientTestName,
				},
			});
			upsertedClientArray.push(upsertedClient.id); // queue this client to be cleaned
			expect(upsertedClient.name).to.equal(upsertedClientTestName);
		});

		it('should update an existing Client if a clientId is passed', async function() {
			const updatedTestClientName = `TEST user ${(new Date()).getTime()} updated`;
			upsertedClient = await CS.upsertClient({
				clientId   : testClient.id,
				attributes : {
					name : updatedTestClientName,
				},
			});
			upsertedClientArray.push(upsertedClient.id); // queue this client to be cleaned
			expect(upsertedClient.name).to.equal(updatedTestClientName);
		});

		it('should create a new Client with custom attributes', async function() {
			this.timeout(15000);
			// SHOULDDO: define custom fields and order in config.js file, and use this isntead of hard coded values
			const updatedTestClientName = `${testClient.name} updated`;
			const upsertClientAttributes = {
				name : updatedTestClientName,
			};
			const upsertClientCustomAttributes = {
				'Account Notes' : 'Test Notes',
			};
			upsertedClient = await CS.upsertClient({
				attributes       : upsertClientAttributes,
				customAttributes : upsertClientCustomAttributes,
			});
			upsertedClientArray.push(upsertedClient.id); // queue this client to be cleaned
			// pull down detailed client model
			expect(upsertedClient.name).to.equal(updatedTestClientName);
			expect(upsertedClient.customFieldValues[0].value).to.equal('Test Notes');
		});

		it('should update an existing Client with custom attribtues', async function() {
			// TODO: this is dependent on the custom fields that are exposed to the ClientSuccess API
			await CS.upsertClient({
				clientId         : testClient.id,
				attributes       : { name : `${testClient.name}updated` },
				customAttributes : { 'Account Notes' : testClient.name },
			});
			// pull back down the user object
			const upsertedCustomClient = await CS.getClient(testClient.id);
			expect(upsertedCustomClient.name).to.equal(`${testClient.name}updated`);
			expect(upsertedCustomClient.customFieldValues[0].value).to.equal(testClient.name);
		});
	});

	describe('getContact', async function() {
		it('should return back the object of an existing contact', async function() {
			if (runWriteTests) {
				// create test client
				const newClientName = `TEST client ${(new Date()).getTime()}`;
				const testClientAttributes = {
					name : newClientName,
				};
				const testClient = await CS.createClient(testClientAttributes);
				// add the clientID to be cleaned up later
				createdTestUsers.push(testClient.id);

				const newContactName = `TEST user ${(new Date()).getTime()}`;

				// create a new contact in this test client
				const testContactAttributes = {
					firstName : newContactName,
					lastName  : newContactName,
				};

				const testContact = await CS.createContact(testClient.id, testContactAttributes);

				const foundContact = await CS.getContact(testContact.clientId, testContact.id);

				expect(foundContact.id).to.equal(testContact.id);
			}
		});

		it('should return back a 404 error object when the contact does not exist', async function() {
			this.timeout(15000);
			// using Client ID 90185858 that does actually exist, with a 0 contact ID that does not
			expect(CS.getContact(90185858, 123)).to.eventually.be.rejectedWith({ status : 404 });
		});

		it('should throw an error when we pass an invalid data type in');
	});

	describe('getContactByEmail', async function() {
		let testClient;

		before(async function() {
			this.timeout(15000);
			const newClientName = `TEST client ${(new Date()).getTime()}`;
			const testExternalID     = `${(new Date()).getTime()}test`;
			const testClientAttributes = {
				name       : newClientName,
				externalId : testExternalID,
			};

			testClient = await CS.createClient(testClientAttributes);
		});

		after(async function() {
			// clean up the test client we created
			await CS.closeClient(testClient.id);
		});

		it('should find a contact that contains a plus sign', async function() {
			const newContactName = `TEST user ${(new Date()).getTime()}`;
			const newContactEmail = 'testemail+plus@dev.roadmunk.com';
			const testContactAttributes = {
				firstName : newContactName,
				lastName  : newContactName,
				email     : newContactEmail,
			};
			const testContact = await CS.createContact(testClient.id, testContactAttributes);
			const foundContact = await CS.getContactByEmail(testClient.externalId, testContact.email);

			expect(foundContact.id).to.equal(testContact.id);
			expect(foundContact.email).to.equal(testContact.email);
		});

		it('should return a 404 if the contact does not exist', async function() {
			try {
				await CS.getContactByEmail(testClient.externalId, 'doesnotexist@test.com');
			}
			catch (error) {
				expect(error.status).to.equal(404);
			}
		});
	});

	describe('createContact', async function() {
		this.timeout(15000);
		let testClient;

		before(async function() {
			const newClientName = `TEST client ${(new Date()).getTime()}`;
			const testClientAttributes = {
				name : newClientName,
			};

			testClient = await CS.createClient(testClientAttributes);
		});

		after(async function() {
			// clean up the test client we created
			await CS.closeClient(testClient.id);
		});

		it('should create a new test contact', async function() {
			const newContactName = `TEST user ${(new Date()).getTime()}`;
			const testContactAttributes = {
				firstName : newContactName,
				lastName  : newContactName,
			};
			const testContact = await CS.createContact(testClient.id, testContactAttributes);

			expect(testContact.firstName).to.equal(newContactName);
			expect(testContact.lastName).to.equal(newContactName);
		});

		it('should create a contact with custom attributes passed', async function() {
			const newContactName = `TEST user ${(new Date()).getTime()}`;
			const testExternalID      = `${(new Date()).getTime()}test`;

			const testContactAttributes = {
				firstName : newContactName,
				lastName  : newContactName,
			};

			// new contact custom attributes to set
			const testContactCustomAttributes = {
				'External ID' : testExternalID,
			};

			let testContact = await CS.createContact(testClient.id, testContactAttributes, testContactCustomAttributes);

			// pull down the contact detail model
			testContact = await CS.getContact(testContact.clientId, testContact.id);
			expect(testContact.customFieldValues[1].value).to.equal(testExternalID);
		});

		it('should error on invalid data');
	});

	describe('updateContact', function() {
		this.timeout(15000);
		let testClient;
		let testContact;
		let newContactName;

		before(async function() {
			const newClientName = `TEST client ${(new Date()).getTime()}`;
			const testClientAttributes = {
				name : newClientName,
			};

			testClient = await CS.createClient(testClientAttributes);

			newContactName = `TEST user ${(new Date()).getTime()}`;

			const testContactAttributes = {
				firstName : newContactName,
				lastName  : newContactName,
			};

			testContact = await CS.createContact(testClient.id, testContactAttributes);
		});

		after(async function() {
			// clean the test client
			CS.closeClient(testClient.id);
		});

		it('should successfully update a contact', async function() {
			// update test contact with new attributes
			const testContactAttributesNew = {
				firstName : `${newContactName}updated`,
			};

			const updatedContact = await CS.updateContact(testContact.clientId, testContact.id, testContactAttributesNew);

			// verify that client has been updated
			expect(updatedContact.firstName).to.equal(`${newContactName}updated`);
		});

		it('should update a contact with custom attributes passed in', async function() {
			const testExternalID           = `${(new Date()).getTime()}test`;
			const testContactAttributesNew = {
				firstName : `${newContactName}updated`,
			};

			const testContactCustomAttributesNew = {
				'External ID' : testExternalID,
			};

			let updatedContact = await CS.updateContact(testContact.clientId, testContact.id, testContactAttributesNew, testContactCustomAttributesNew);

			// pull down the contact detail object
			updatedContact = await CS.getContact(testContact.clientId, testContact.id);

			// verify that client has been updated
			expect(updatedContact.customFieldValues[1].value).to.equal(testExternalID);
		});

		it('should error when we pass an invalid data type in', async function() {
			expect(CS.updateContact('abc', 'abc')).to.eventually.be.rejectedWith({ status : 400 });
		});
	});

	describe('upsertContact', async function() {
		this.timeout(15000);
		let testClient;
		let testContact;
		let newContactName;

		before(async function() {
			const newClientName = `TEST client ${(new Date()).getTime()}`;
			const testExternalID     = `${(new Date()).getTime()}test`;
			const testClientAttributes = {
				name       : newClientName,
				externalId : testExternalID,
			};

			testClient = await CS.createClient(testClientAttributes);

			newContactName = `TEST user ${(new Date()).getTime()}`;

			const testContactAttributes = {
				firstName : newContactName,
				lastName  : newContactName,
			};

			testContact = await CS.createContact(testClient.id, testContactAttributes);
		});

		after(async function() {
			CS.closeClient(testClient.id);
		});

		it('should automatically create a Contact if there is an undefined contactId present in the function arguments', async function() {
			const upsertedContactTestName = `TEST${(new Date()).getTime()}`;
			const upsertedContact = await CS.upsertContact({
				clientId   : testClient.id,
				attributes : {
					firstName : upsertedContactTestName,
					lastName  : upsertedContactTestName,
					email     : `${upsertedContactTestName}@dev.roadmunk.com`,
				},
			});
			expect(upsertedContact.firstName).to.equal(upsertedContactTestName);
			expect(upsertedContact.lastName).to.equal(upsertedContactTestName);
		});

		it('should automatically create a Contact if there is a blank contactId present in the function arguments', async function() {
			const upsertedContactTestName = `TEST${(new Date()).getTime()}test2`;
			const upsertedContact = await CS.upsertContact({
				clientId   : testClient.id,
				contactId  : '',
				attributes : {
					firstName : upsertedContactTestName,
					lastName  : upsertedContactTestName,
					email     : `${upsertedContactTestName}@dev.roadmunk.com`,
				},
			});
			expect(upsertedContact.firstName).to.equal(upsertedContactTestName);
			expect(upsertedContact.lastName).to.equal(upsertedContactTestName);
		});

		it('should automatically create a Contact if only attributes are passed in', async function() {
			const upsertedContactTestName = `TEST${(new Date()).getTime()}test3`;
			const upsertedContact = await CS.upsertContact({
				clientId   : testClient.id,
				attributes : {
					firstName : upsertedContactTestName,
					lastName  : upsertedContactTestName,
					email     : `${upsertedContactTestName}@dev.roadmunk.com`,
				},
			});
			expect(upsertedContact.firstName).to.equal(upsertedContactTestName);
			expect(upsertedContact.lastName).to.equal(upsertedContactTestName);
		});

		it('should update an existing Contact if a contactId is passed', async function() {
			const upsertedContactTestName = `TEST${(new Date()).getTime()}test4`;
			const upsertedContact = await CS.upsertContact({
				clientId   : testClient.id,
				contactId  : testContact.id,
				attributes : {
					firstName : upsertedContactTestName,
					lastName  : upsertedContactTestName,
					email     : `${upsertedContactTestName}@dev.roadmunk.com`,
				},
			});
			expect(upsertedContact.id).to.equal(testContact.id);
			expect(upsertedContact.firstName).to.equal(upsertedContactTestName);
			expect(upsertedContact.lastName).to.equal(upsertedContactTestName);
		});

		it('should create a new Contact with custom attributes', async function() {
			const upsertedContactTestName = `TEST${(new Date()).getTime()}test5`;
			const testExternalID               = `${(new Date()).getTime()}test`;
			const contactAttributes = {
				firstName : upsertedContactTestName,
				lastName  : upsertedContactTestName,
				email     : `${upsertedContactTestName}@dev.roadmunk.com`,
			};
			const contactCustomAttributes = {
				'External ID' : testExternalID,
			};
			let upsertedContact = await CS.upsertContact({
				clientId         : testClient.id,
				attributes       : contactAttributes,
				customAttributes : contactCustomAttributes,
			});
			// pull down full contact detail object
			upsertedContact = await CS.getContact(testClient.id, upsertedContact.id);
			expect(upsertedContact.firstName).to.equal(upsertedContactTestName);
			expect(upsertedContact.lastName).to.equal(upsertedContactTestName);
			expect(upsertedContact.customFieldValues[1].value).to.equal(testExternalID);
		});

		it('should update an existing Contact with custom attribtues', async function() {
			const upsertedContactTestName = `TEST${(new Date()).getTime()}test6`;
			const testExternalID               = `${(new Date()).getTime()}test`;
			const newContactAttributes = {
				firstName : `${upsertedContactTestName}updated`,
				lastName  : `${upsertedContactTestName}updated`,
				email     : `${upsertedContactTestName}@dev.roadmunk.com`,
			};
			const newContactCustomAttributes = {
				'External ID' : `${testExternalID}updated`,
			};
			let upsertedContact = await CS.upsertContact({
				clientId         : testClient.id,
				contactId        : testContact.id,
				attributes       : newContactAttributes,
				customAttributes : newContactCustomAttributes,
			});
			// pull down full contact detail object
			upsertedContact = await CS.getContact(testClient.id, upsertedContact.id);
			expect(upsertedContact.id).to.equal(testContact.id);
			expect(upsertedContact.firstName).to.equal(`${upsertedContactTestName}updated`);
			expect(upsertedContact.lastName).to.equal(`${upsertedContactTestName}updated`);
			expect(upsertedContact.customFieldValues[1].value).to.equal(`${testExternalID}updated`);
		});

		it('should not create a new contact if it has already been created under this client', async function() {
			const newContactName  = `TEST user ${(new Date()).getTime()}`;
			const newContactEmail = `testuser${(new Date()).getTime()}@dev.roadmunk.com`;

			const testContactAttributes = {
				firstName : newContactName,
				lastName  : newContactName,
				email     : newContactEmail,
			};

			const testContact1 = await CS.upsertContact({
				clientId   : testClient.id,
				attributes : testContactAttributes,
			});

			const testContact2 = await CS.upsertContact({
				clientId   : testClient.id,
				attributes : testContactAttributes,
			});

			// we would expect that the query does not create a new user if we are attempting to create a duplciate
			expect(testContact1.id).to.equal(testContact2.id);
		});
	});

	describe('getClientTypeId', async function() {
		it('should return back the appropriate client type ID when a client type label is passed', async function() {
			this.timeout(15000);
			const businessClientTypeId = await CS.getClientTypeId('Business');
			expect(businessClientTypeId).to.equal(3535);
		});

		it('should throw an error on invalid data', async function() {
			expect(CS.getClientTypeId()).to.eventually.be.rejectedWith({ status : 400 });
		});
	});

	describe('getClientByExternalId', async function() {
		it('should error with 404 if the external ID does not exist', async function() {
			expect(CS.getClientByExternalId('123456')).to.eventually.be.rejectedWith({ status : 404 });
		});
	});

	describe('cleanup', async function() {
		if (runWriteTests) {
			// set a longer timeout for this function as it will surely take longer than 2 seconds to clean everything
			this.timeout(15000);

			it('should clean up test data', async function() {
				const cleanupAttributes = {
					statusId : 4, // 'terminated' status
				};

				for (let i = 0; i < createdTestUsers.length; i++) {
					await CS.updateClient(createdTestUsers[i], cleanupAttributes);
					console.log(`Test Client ${createdTestUsers[i]} cleaned.`);
				}
			});
		}
	});
});
